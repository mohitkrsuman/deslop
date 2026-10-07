import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SkippedDirectory, SkippedFile } from "./types.mts";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]);
const ALWAYS_IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

interface IgnoreRule {
  base: string;
  pattern: string;
  directoryOnly: boolean;
  negated: boolean;
  regex: RegExp;
}

export interface WalkResult {
  sourcePaths: string[];
  filesFound: number;
  skippedFiles: SkippedFile[];
  skippedDirectories: SkippedDirectory[];
}

// Converts an OS path to forward slashes so repo paths match on every platform.
export function toRepoPath(value: string): string {
  return value.split(path.sep).join("/");
}

// True for JS/TS extensions, the only files the parser reads.
export function isSourcePath(value: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

// Compiles one .gitignore glob to a regex. `**` crosses folders, `*` and `?`
// stay inside one segment. Anchored patterns match from the rule's own folder;
// unanchored ones match at any depth below it.
function globRegex(pattern: string, anchored: boolean): RegExp {
  let expression = anchored ? "^" : "(?:^|/)";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[\\^$+.()|{}\[\]]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}(?:/|$)`);
}

// Reads one directory's .gitignore into rules scoped to that directory. No file
// means no rules; any other read error is thrown so the caller records it.
async function readIgnoreRules(directory: string, base: string): Promise<IgnoreRule[]> {
  let contents: string;
  try {
    contents = await readFile(path.join(directory, ".gitignore"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return contents.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return [];
    const negated = line.startsWith("!");
    const rule = negated ? line.slice(1) : line;
    const directoryOnly = rule.endsWith("/");
    const pattern = rule.replace(/^\//, "").replace(/\/$/, "");
    if (!pattern) return [];
    return [{
      base,
      pattern,
      directoryOnly,
      negated,
      regex: globRegex(pattern, rule.startsWith("/") || pattern.includes("/")),
    }];
  });
}

// Returns why a path is ignored, or null. Rules run in order and the last match
// wins, so a later `!pattern` can un-ignore. .git and node_modules always are.
function ignoredBy(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): string | null {
  const name = path.posix.basename(relativePath);
  if (isDirectory && ALWAYS_IGNORED_DIRECTORIES.has(name)) {
    return `default directory exclusion: ${name}`;
  }

  let reason: string | null = null;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.base && relativePath !== rule.base && !relativePath.startsWith(`${rule.base}/`)) continue;
    const scoped = rule.base ? relativePath.slice(rule.base.length + 1) : relativePath;
    if (rule.regex.test(scoped)) {
      reason = rule.negated ? null : `.gitignore: ${rule.pattern}${rule.directoryOnly ? "/" : ""}`;
    }
  }
  return reason;
}

// Walks the repo depth-first in name order, collecting source files and
// recording every skipped file and directory with a reason. Symlinks are
// counted and skipped, never followed.
export async function walkRepository(root: string): Promise<WalkResult> {
  const result: WalkResult = {
    sourcePaths: [],
    filesFound: 0,
    skippedFiles: [],
    skippedDirectories: [],
  };

  // Visits one directory with its parent's rules plus its own .gitignore.
  async function visit(directory: string, relativeDirectory: string, parentRules: IgnoreRule[]): Promise<void> {
    let rules = parentRules;
    try {
      rules = [...parentRules, ...await readIgnoreRules(directory, relativeDirectory)];
    } catch (error) {
      result.skippedDirectories.push({
        path: relativeDirectory || ".",
        reason: "read_error",
        detail: `Could not read .gitignore: ${String(error)}`,
      });
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      result.skippedDirectories.push({
        path: relativeDirectory || ".",
        reason: "read_error",
        detail: `Could not list directory: ${String(error)}`,
      });
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        result.filesFound += 1;
        result.skippedFiles.push({ path: relativePath, reason: "symbolic_link", detail: "Symlink not followed" });
      } else if (entry.isDirectory()) {
        const reason = ignoredBy(relativePath, true, rules);
        if (reason) {
          result.skippedDirectories.push({ path: relativePath, reason: "ignored", detail: reason });
        } else {
          await visit(absolutePath, relativePath, rules);
        }
      } else if (entry.isFile()) {
        result.filesFound += 1;
        const ignored = ignoredBy(relativePath, false, rules);
        if (ignored) {
          result.skippedFiles.push({ path: relativePath, reason: "ignored", detail: ignored });
        } else if (!isSourcePath(relativePath)) {
          result.skippedFiles.push({
            path: relativePath,
            reason: "unsupported_extension",
            detail: `Not a JavaScript or TypeScript source file (${path.extname(relativePath) || "no extension"})`,
          });
        } else {
          result.sourcePaths.push(relativePath);
        }
      }
    }
  }

  await visit(root, "", []);
  return result;
}
