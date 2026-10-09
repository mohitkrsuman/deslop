import type ts from "typescript";

export const PARSER_SCHEMA_VERSION = 2 as const;

export type ImportKind = "import" | "re-export" | "dynamic-import" | "require";

export type SkipReason =
  | "unsupported_extension"
  | "ignored"
  | "symbolic_link"
  | "read_error"
  | "parse_error";

export interface SkippedFile {
  path: string;
  reason: SkipReason;
  detail: string;
}

export interface SkippedDirectory {
  path: string;
  reason: "ignored" | "symbolic_link" | "read_error";
  detail: string;
}

export interface FileNode {
  path: string;
  folder: string;
  moduleId: string;
  kind: string;
  // Statically named CommonJS exports; absent on rows loaded from older analyses.
  commonjsExports?: string[];
  lineCount: number;
  sha256: string;
  fanIn: number;
  fanOut: number;
}

export interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
}

export type ImportObservation =
  | {
      from: string;
      specifier: string;
      kind: ImportKind;
      line: number;
      status: "resolved";
      to: string;
    }
  | {
      from: string;
      specifier: string;
      kind: ImportKind;
      line: number;
      status: "external" | "excluded" | "unresolved";
      reason: string;
    };

export interface ParserCoverage {
  filesFound: number;
  filesParsed: number;
  filesSkipped: number;
  skippedFiles: SkippedFile[];
  skippedDirectories: SkippedDirectory[];
  configurationWarnings: string[];
  // Why routes were withheld, so an empty route table is explained, not blank.
  routeNotes: string[];
  imports: {
    found: number;
    resolved: number;
    external: number;
    excluded: number;
    unresolved: number;
    unresolvedExamples: ImportObservation[];
  };
}

export interface ParserResult {
  schemaVersion: typeof PARSER_SCHEMA_VERSION;
  root: string;
  adapter: string;
  files: FileNode[];
  edges: Edge[];
  imports: ImportObservation[];
  routes: Route[];
  coverage: ParserCoverage;
}

// A route exists only when its method and full pattern were both read from the
// syntax. The pattern is written the way the framework writes it.
export interface Route {
  file: string;
  method: string;
  path: string;
  line: number;
}

export interface RepositoryListing {
  root: string;
  // Source files the parser will read.
  sourcePaths: string[];
  // Other files found and not ignored, e.g. package.json, for detection.
  otherPaths: string[];
}

export interface AdapterFile {
  path: string;
  source: ts.SourceFile;
}

// One adapter applied to one repository. Files are inspected once each, in
// path order, then finish() returns what needed the whole repository to know.
export interface AdapterRun {
  name: string;
  roleOf(file: AdapterFile): string;
  finish(): { routes: Route[]; notes: string[] };
}

// Framework knowledge. detect() returns null when the repository isn't one of
// its kind; the parser tries adapters in the order given and the first wins.
export interface RepositoryAdapter {
  name: string;
  detect(repository: RepositoryListing): Promise<AdapterRun | null>;
}
