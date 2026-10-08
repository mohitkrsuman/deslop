import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { genericRun } from "./adapters/generic.mts";
import { withFanCounts } from "./graph.mts";
import { walkRepository, toRepoPath } from "./walk.mts";
import {
  PARSER_SCHEMA_VERSION,
  type AdapterRun,
  type Edge,
  type FileNode,
  type ImportKind,
  type ImportObservation,
  type ParserResult,
  type RepositoryAdapter,
  type SkippedFile,
} from "./types.mts";

const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  resolveJsonModule: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

interface FoundImport {
  kind: ImportKind;
  specifier: string;
  line: number;
  literal: boolean;
}

// Path without its source extension, e.g. `lib/env.ts` -> `lib/env`.
function moduleIdFor(relativePath: string): string {
  return relativePath.replace(/(?:\.d)?\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/i, "");
}

// Counts lines like an editor does: a trailing newline doesn't add a line.
function lineCount(contents: string): number {
  if (!contents) return 0;
  const lines = contents.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(contents) ? lines - 1 : lines;
}

// Finds every import, `export ... from` and `import()` in a file, with its line.
// A dynamic import with a non-literal argument is kept and flagged so it can be
// reported as excluded rather than silently dropped.
function collectImports(source: ts.SourceFile): FoundImport[] {
  const found: FoundImport[] = [];
  // Records one import at the line where its node starts.
  function add(kind: ImportKind, specifier: string, node: ts.Node, literal = true): void {
    found.push({
      kind,
      specifier,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      literal,
    });
  }
  // Walks the whole tree so imports nested inside functions are found too.
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add("import", node.moduleSpecifier.text, node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
               ts.isStringLiteralLike(node.moduleSpecifier)) {
      add("re-export", node.moduleSpecifier.text, node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        add("dynamic-import", argument.text, node);
      } else {
        add("dynamic-import", argument?.getText(source) ?? "<missing argument>", node, false);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

// True when target is strictly inside root; root itself doesn't count.
function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// True when a specifier matches a tsconfig `paths` pattern. Only used to word
// the unresolved reason; it never resolves anything itself.
function aliasMatches(specifier: string, paths: ts.MapLike<string[]> | undefined): boolean {
  if (!paths) return false;
  return Object.keys(paths).some((pattern) => {
    const star = pattern.indexOf("*");
    return star < 0
      ? pattern === specifier
      : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
  });
}

// True if the path exists. Missing is false; any other stat error is thrown.
async function existsOnDisk(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// Finds the compiler options for a file from the nearest tsconfig.json or
// jsconfig.json walking up to the root, cached per config. A broken config
// falls back to defaults and is recorded as a warning instead of failing the run.
class CompilerOptionsByFile {
  private readonly cache = new Map<string, ts.CompilerOptions>();
  private readonly root: string;
  readonly warnings: string[] = [];

  constructor(root: string) {
    this.root = root;
  }

  // Options from the nearest config above filePath, or defaults if none.
  async get(filePath: string): Promise<ts.CompilerOptions> {
    let directory = path.dirname(filePath);
    while (directory === this.root || insideRoot(this.root, directory)) {
      for (const configName of ["tsconfig.json", "jsconfig.json"]) {
        const configPath = path.join(/* turbopackIgnore: true */ directory, configName);
        if (!await existsOnDisk(configPath)) continue;
        const cached = this.cache.get(configPath);
        if (cached) return cached;
        try {
          // TypeScript expects normalized paths when attaching JSON diagnostics on Windows.
          const read = ts.readConfigFile(toRepoPath(configPath), ts.sys.readFile);
          if (read.error) {
            this.warnings.push(`${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
            this.cache.set(configPath, DEFAULT_COMPILER_OPTIONS);
            return DEFAULT_COMPILER_OPTIONS;
          }
          const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, toRepoPath(directory));
          const errors = parsed.errors.filter((error) => error.category === ts.DiagnosticCategory.Error);
          if (errors.length > 0) {
            this.warnings.push(`${configPath}: ${errors.map((error) =>
              ts.flattenDiagnosticMessageText(error.messageText, " ")).join("; ")}`);
          }
          const options = { ...DEFAULT_COMPILER_OPTIONS, ...parsed.options };
          this.cache.set(configPath, options);
          return options;
        } catch (error) {
          this.warnings.push(`${configPath}: ${String(error)}`);
          this.cache.set(configPath, DEFAULT_COMPILER_OPTIONS);
          return DEFAULT_COMPILER_OPTIONS;
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return DEFAULT_COMPILER_OPTIONS;
  }
}

// Classifies one import using TypeScript's own module resolution. It's
// resolved only when TypeScript lands on a file we parsed. Anything else gets a
// status and a reason: external (built-in or package), excluded (non-literal or
// target skipped) or unresolved (nothing found). Never guessed.
async function resolveImport(
  root: string,
  fromAbsolute: string,
  found: FoundImport,
  selectedPaths: Set<string>,
  skippedPaths: Map<string, SkippedFile>,
  options: ts.CompilerOptions,
): Promise<ImportObservation> {
  const common = {
    from: toRepoPath(path.relative(root, fromAbsolute)),
    specifier: found.specifier,
    kind: found.kind,
    line: found.line,
  };
  if (!found.literal) {
    return { ...common, status: "excluded", reason: "dynamic import argument is not a literal string" };
  }
  if (found.specifier.startsWith("node:") || BUILTINS.has(found.specifier)) {
    return { ...common, status: "external", reason: "Node.js built-in module" };
  }

  const resolved = ts.resolveModuleName(found.specifier, fromAbsolute, options, ts.sys).resolvedModule;
  if (resolved) {
    const absoluteTarget = path.resolve(resolved.resolvedFileName);
    if (resolved.isExternalLibraryImport || !insideRoot(root, absoluteTarget)) {
      return { ...common, status: "external", reason: `resolved to external library: ${absoluteTarget}` };
    }
    const target = toRepoPath(path.relative(root, absoluteTarget));
    if (selectedPaths.has(target)) return { ...common, status: "resolved", to: target };
    const skipped = skippedPaths.get(target);
    return {
      ...common,
      status: "excluded",
      reason: skipped ? `target skipped (${skipped.reason}): ${skipped.detail}` : "target is outside selected source files",
    };
  }

  if (found.specifier.startsWith(".") || found.specifier.startsWith("/")) {
    const candidate = path.resolve(path.dirname(fromAbsolute), found.specifier);
    if (insideRoot(root, candidate) && await existsOnDisk(candidate)) {
      return { ...common, status: "excluded", reason: "target exists but is not a supported source module" };
    }
    return { ...common, status: "unresolved", reason: "relative target does not exist or cannot be resolved" };
  }
  return {
    ...common,
    status: "unresolved",
    reason: aliasMatches(found.specifier, options.paths)
      ? "path alias target does not exist or cannot be resolved"
      : "package or module cannot be resolved",
  };
}

// Entry point: walks the repo, parses each source file, resolves each import,
// and returns files, edges, routes and a coverage report. A file that can't be
// read or has syntax errors is skipped and counted, never partly included.
// Edges are deduplicated per (from, to, kind). Adapters are tried in the order
// given and the first to recognise the repository assigns roles and routes;
// with none, every file gets a generic role and there are no routes.
export async function parseRepository(
  directory: string,
  adapters: readonly RepositoryAdapter[] = [],
): Promise<ParserResult> {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${directory}`);
  const walked = await walkRepository(root);
  const listing = {
    root,
    sourcePaths: walked.sourcePaths,
    otherPaths: walked.skippedFiles.filter((file) => file.reason === "unsupported_extension").map((file) => file.path),
  };
  let adapter: AdapterRun | null = null;
  for (const candidate of adapters) {
    adapter = await candidate.detect(listing);
    if (adapter) break;
  }
  adapter ??= genericRun();
  const skippedFiles = [...walked.skippedFiles];
  const skippedPaths = new Map(skippedFiles.map((file) => [file.path, file]));
  const parsed = new Map<string, { node: FileNode; imports: FoundImport[] }>();

  for (const relativePath of walked.sourcePaths) {
    const absolutePath = path.join(root, relativePath);
    try {
      const bytes = await readFile(absolutePath);
      const contents = bytes.toString("utf8");
      const source = ts.createSourceFile(absolutePath, contents, ts.ScriptTarget.Latest, true);
      const syntaxErrors = /\.d\.[cm]?ts$/i.test(relativePath) ? [] :
        ts.transpileModule(contents, {
          fileName: absolutePath,
          reportDiagnostics: true,
          compilerOptions: { module: ts.ModuleKind.ESNext },
        }).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
      if (syntaxErrors.length > 0) {
        throw new Error(syntaxErrors.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; "));
      }
      const moduleId = moduleIdFor(relativePath);
      parsed.set(relativePath, {
        node: {
          path: relativePath,
          folder: toRepoPath(path.dirname(relativePath)) || ".",
          moduleId,
          kind: adapter.roleOf({ path: relativePath, source }),
          lineCount: lineCount(contents),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          fanIn: 0,
          fanOut: 0,
        },
        imports: collectImports(source),
      });
    } catch (error) {
      const skipped: SkippedFile = {
        path: relativePath,
        reason: (error as NodeJS.ErrnoException).code ? "read_error" : "parse_error",
        detail: String(error),
      };
      skippedFiles.push(skipped);
      skippedPaths.set(relativePath, skipped);
    }
  }

  const selectedPaths = new Set(parsed.keys());
  const compilerOptions = new CompilerOptionsByFile(root);
  const imports: ImportObservation[] = [];
  for (const [relativePath, file] of parsed) {
    const absolutePath = path.join(root, relativePath);
    const options = await compilerOptions.get(absolutePath);
    for (const found of file.imports) {
      imports.push(await resolveImport(root, absolutePath, found, selectedPaths, skippedPaths, options));
    }
  }

  const edgeKeys = new Set<string>();
  const edges: Edge[] = [];
  for (const observation of imports) {
    if (observation.status !== "resolved") continue;
    const edge = { from: observation.from, to: observation.to, kind: observation.kind };
    const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }

  const { routes, notes: routeNotes } = adapter.finish();
  const files = withFanCounts([...parsed.values()].map((item) => item.node), edges);
  const statusCount = (status: ImportObservation["status"]): number =>
    imports.filter((item) => item.status === status).length;
  return {
    schemaVersion: PARSER_SCHEMA_VERSION,
    root,
    adapter: adapter.name,
    files,
    edges,
    imports,
    routes,
    coverage: {
      filesFound: walked.filesFound,
      filesParsed: files.length,
      filesSkipped: skippedFiles.length,
      skippedFiles,
      skippedDirectories: walked.skippedDirectories,
      configurationWarnings: compilerOptions.warnings,
      routeNotes,
      imports: {
        found: imports.length,
        resolved: statusCount("resolved"),
        external: statusCount("external"),
        excluded: statusCount("excluded"),
        unresolved: statusCount("unresolved"),
        unresolvedExamples: imports.filter((item) => item.status === "unresolved").slice(0, 20),
      },
    },
  };
}
