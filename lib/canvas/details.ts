import type { Edge, FileNode } from "../parser/types.mts";
import { buildGraphIndex } from "../graph/graph.ts";
import { GENERIC_ROLES } from "../taxonomy.mts";

export interface DetailIndex {
  fileByPath: Map<string, FileNode>;
  dependencies: Map<string, string[]>;
  dependents: Map<string, string[]>;
  mostDependedOn: FileNode[];
  unimported: FileNode[];
  unidentifiedCount: number;
}

// The parser may report several import kinds between the same two files. Pane
// counts describe distinct neighbouring files, matching the parser's fan counts.
export function buildDetailIndex(files: FileNode[], edges: Edge[]): DetailIndex {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const { dependencies: dependencyLists, dependents: dependentLists } = buildGraphIndex(files, edges);
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
    unidentifiedCount: files.filter((file) => file.kind === GENERIC_ROLES.other).length,
  };
}
