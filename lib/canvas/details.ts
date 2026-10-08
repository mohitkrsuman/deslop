import type { Edge, FileNode } from "../parser/types.mts";

export interface DetailIndex {
  fileByPath: Map<string, FileNode>;
  dependencies: Map<string, string[]>;
  dependents: Map<string, string[]>;
  mostDependedOn: FileNode[];
  unimported: FileNode[];
  routeCount: number;
  unidentifiedCount: number;
}

// The parser may report several import kinds between the same two files. Pane
// counts describe distinct neighbouring files, matching the parser's fan counts.
export function buildDetailIndex(files: FileNode[], edges: Edge[]): DetailIndex {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const dependencies = new Map(files.map((file) => [file.path, new Set<string>()]));
  const dependents = new Map(files.map((file) => [file.path, new Set<string>()]));

  for (const edge of edges) {
    dependencies.get(edge.from)?.add(edge.to);
    dependents.get(edge.to)?.add(edge.from);
  }

  const dependencyLists = new Map([...dependencies].map(([path, paths]) => [path, [...paths].sort()]));
  const dependentLists = new Map([...dependents].map(([path, paths]) => [path, [...paths].sort()]));
  const incomingCount = (file: FileNode) => dependentLists.get(file.path)?.length ?? 0;
  const outgoingCount = (file: FileNode) => dependencyLists.get(file.path)?.length ?? 0;

  return {
    fileByPath,
    dependencies: dependencyLists,
    dependents: dependentLists,
    mostDependedOn: files.filter((file) => incomingCount(file) > 0)
      .sort((left, right) => incomingCount(right) - incomingCount(left) || left.path.localeCompare(right.path)),
    unimported: files.filter((file) => incomingCount(file) === 0)
      .sort((left, right) => outgoingCount(right) - outgoingCount(left) || left.path.localeCompare(right.path)),
    routeCount: files.filter((file) => file.kind === "route" || file.kind === "page" || file.kind === "api-route").length,
    unidentifiedCount: files.filter((file) => file.kind === "module" || file.kind === "unknown").length,
  };
}
