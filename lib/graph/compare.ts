import type { Edge, FileNode, ParserCoverage } from "../parser/types.mts";

// What a change did to the map, from two parses and nothing else. Files are
// the same file only when their paths match; imports are the same import only
// when they join the same two files. A rename is a removal and an addition.
export interface MapComparison {
  // After-side nodes, so they can be drawn beside the base map.
  added: FileNode[];
  removed: string[];
  // Same path, different content hash.
  changed: string[];
  // Base files the after side found but couldn't parse. Unparsed is not deleted.
  unparsed: { path: string; reason: string; detail: string }[];
  addedEdges: Edge[];
  removedEdges: Edge[];
}

export function pairKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function pairsOf(edges: Edge[]): Map<string, Edge> {
  const pairs = new Map<string, Edge>();
  for (const edge of edges) {
    const key = pairKey(edge.from, edge.to);
    if (!pairs.has(key)) pairs.set(key, edge);
  }
  return pairs;
}

function within(path: string, directory: string): boolean {
  return directory === "." || path === directory || path.startsWith(`${directory}/`);
}

export function compareMaps(
  base: { files: Pick<FileNode, "path" | "sha256">[]; edges: Edge[] },
  after: { files: FileNode[]; edges: Edge[]; coverage: ParserCoverage },
): MapComparison {
  const afterByPath = new Map(after.files.map((file) => [file.path, file]));
  const baseByPath = new Map(base.files.map((file) => [file.path, file]));
  const skipped = new Map(after.coverage.skippedFiles.map((file) => [file.path, file]));

  const removed: string[] = [];
  const changed: string[] = [];
  const unparsed: MapComparison["unparsed"] = [];
  for (const file of base.files) {
    const counterpart = afterByPath.get(file.path);
    if (counterpart) {
      if (counterpart.sha256 !== file.sha256) changed.push(file.path);
      continue;
    }
    const skip = skipped.get(file.path)
      ?? after.coverage.skippedDirectories.find((directory) => within(file.path, directory.path));
    if (skip) unparsed.push({ path: file.path, reason: skip.reason, detail: skip.detail });
    else removed.push(file.path);
  }
  const added = after.files.filter((file) => !baseByPath.has(file.path)).map((file) => ({
    path: file.path, folder: file.folder, moduleId: file.moduleId, kind: file.kind,
    lineCount: file.lineCount, sha256: file.sha256, fanIn: file.fanIn, fanOut: file.fanOut,
  }));

  // An import from or to a file the after side couldn't parse is unknown on
  // that side, so it isn't reported as removed.
  const unknown = new Set(unparsed.map((file) => file.path));
  const basePairs = pairsOf(base.edges);
  const afterPairs = pairsOf(after.edges);
  const addedEdges = [...afterPairs].filter(([key]) => !basePairs.has(key)).map(([, edge]) => edge);
  const removedEdges = [...basePairs]
    .filter(([key, edge]) => !afterPairs.has(key) && !unknown.has(edge.from) && !unknown.has(edge.to))
    .map(([, edge]) => edge);

  const byPath = (left: string, right: string) => left.localeCompare(right);
  const byEdge = (left: Edge, right: Edge) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
  return {
    added: added.sort((left, right) => byPath(left.path, right.path)),
    removed: removed.sort(byPath),
    changed: changed.sort(byPath),
    unparsed,
    addedEdges: addedEdges.sort(byEdge),
    removedEdges: removedEdges.sort(byEdge),
  };
}
