export const PARSER_SCHEMA_VERSION = 1 as const;

export type ImportKind = "import" | "re-export" | "dynamic-import";

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
  coverage: ParserCoverage;
}

export interface RepositoryAdapter {
  name: string;
  classifyFile(file: { path: string; moduleId: string }): string;
}

export const fallbackAdapter: RepositoryAdapter = {
  name: "fallback",
  classifyFile: () => "module",
};
