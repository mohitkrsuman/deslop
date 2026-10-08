import { readFile, writeFile } from "node:fs/promises";
import { PARSER_SCHEMA_VERSION, type ParserResult } from "./types.mts";

// A plain object: not null, not an array.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Narrows unknown to string.
function isString(value: unknown): value is string {
  return typeof value === "string";
}

// Counts and line numbers: whole numbers, zero or more.
function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

// An array where every entry passes the predicate.
function isArrayOf<T>(value: unknown, predicate: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every(predicate);
}

// One of the three import kinds the parser records.
function isImportKind(value: unknown): boolean {
  return value === "import" || value === "re-export" || value === "dynamic-import";
}

// One import record. A resolved import must name its target file; every other
// status must carry a reason, because nothing is reported without one.
function isImportObservation(item: unknown): item is ParserResult["imports"][number] {
  if (!isRecord(item) || !isString(item.from) || !isString(item.specifier) ||
      !isImportKind(item.kind) || !isNonnegativeInteger(item.line) || item.line < 1) return false;
  return item.status === "resolved"
    ? isString(item.to)
    : (item.status === "external" || item.status === "excluded" || item.status === "unresolved") &&
      isString(item.reason);
}

// Checks a loaded JSON value is a complete ParserResult. Beyond the shape, it
// rejects results whose totals disagree with their lists, or with an edge that
// isn't backed by a resolved import between two parsed files.
export function isParserResult(value: unknown): value is ParserResult {
  if (!isRecord(value) || value.schemaVersion !== PARSER_SCHEMA_VERSION ||
      !isString(value.root) || !isString(value.adapter)) return false;

  if (!isArrayOf(value.files, (file): file is ParserResult["files"][number] =>
    isRecord(file) && isString(file.path) && isString(file.folder) &&
    isString(file.moduleId) && isString(file.kind) && isString(file.sha256) &&
    /^[a-f0-9]{64}$/.test(file.sha256) && isNonnegativeInteger(file.lineCount) &&
    isNonnegativeInteger(file.fanIn) && isNonnegativeInteger(file.fanOut))) return false;

  if (!isArrayOf(value.edges, (edge): edge is ParserResult["edges"][number] =>
    isRecord(edge) && isString(edge.from) && isString(edge.to) && isImportKind(edge.kind))) return false;

  if (!isArrayOf(value.imports, isImportObservation)) return false;

  if (!isArrayOf(value.routes, (route): route is ParserResult["routes"][number] =>
    isRecord(route) && isString(route.file) && isString(route.method) && isString(route.path) &&
    route.path.startsWith("/") && isNonnegativeInteger(route.line) && route.line >= 1)) return false;

  const coverage = value.coverage;
  if (!isRecord(coverage) || !isNonnegativeInteger(coverage.filesFound) ||
      !isNonnegativeInteger(coverage.filesParsed) || !isNonnegativeInteger(coverage.filesSkipped) ||
      coverage.filesFound !== coverage.filesParsed + coverage.filesSkipped) return false;
  if (!isArrayOf(coverage.skippedFiles, (file): file is ParserResult["coverage"]["skippedFiles"][number] =>
    isRecord(file) && isString(file.path) && isString(file.detail) &&
    (file.reason === "unsupported_extension" || file.reason === "ignored" ||
      file.reason === "symbolic_link" || file.reason === "read_error" || file.reason === "parse_error"))) return false;
  if (!isArrayOf(coverage.skippedDirectories, (directory): directory is ParserResult["coverage"]["skippedDirectories"][number] =>
    isRecord(directory) && isString(directory.path) && isString(directory.detail) &&
    (directory.reason === "ignored" || directory.reason === "symbolic_link" || directory.reason === "read_error"))) return false;
  if (!isArrayOf(coverage.configurationWarnings, isString) || !isArrayOf(coverage.routeNotes, isString)) return false;

  const imports = coverage.imports;
  if (!isRecord(imports) || !isNonnegativeInteger(imports.found) ||
      !isNonnegativeInteger(imports.resolved) || !isNonnegativeInteger(imports.external) ||
      !isNonnegativeInteger(imports.excluded) || !isNonnegativeInteger(imports.unresolved) ||
      !isArrayOf(imports.unresolvedExamples, isImportObservation) ||
      imports.unresolvedExamples.some((item) => item.status !== "unresolved")) return false;
  const filePaths = new Set(value.files.map((file) => file.path));
  const resolvedKeys = new Set(value.imports.filter((item) => item.status === "resolved")
    .map((item) => `${item.from}\0${item.to}\0${item.kind}`));
  if (value.edges.some((edge) => !filePaths.has(edge.from) || !filePaths.has(edge.to) ||
      !resolvedKeys.has(`${edge.from}\0${edge.to}\0${edge.kind}`))) return false;
  if (value.routes.some((route) => !filePaths.has(route.file))) return false;
  return imports.found === value.imports.length &&
    imports.found === imports.resolved + imports.external + imports.excluded + imports.unresolved &&
    imports.resolved === value.imports.filter((item) => item.status === "resolved").length &&
    imports.external === value.imports.filter((item) => item.status === "external").length &&
    imports.excluded === value.imports.filter((item) => item.status === "excluded").length &&
    imports.unresolved === value.imports.filter((item) => item.status === "unresolved").length &&
    coverage.filesParsed === value.files.length &&
    coverage.filesSkipped === coverage.skippedFiles.length;
}

// Saves a result as pretty-printed JSON.
export async function writeParserResult(filePath: string, result: ParserResult): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

// Loads a saved result and throws unless it passes isParserResult.
export async function readParserResult(filePath: string): Promise<ParserResult> {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isParserResult(value)) throw new Error(`Invalid parser result schema in ${filePath}`);
  return value;
}
