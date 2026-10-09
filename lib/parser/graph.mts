import type { Edge, FileNode } from "./types.mts";

// Returns the files with fanIn (distinct files depending on it) and fanOut
// (distinct files it depends on). Distinct, so multiple reference kinds
// between the same pair count once.
export function withFanCounts(files: FileNode[], edges: Edge[]): FileNode[] {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, new Set());
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Set());
    incoming.get(edge.to)?.add(edge.from);
    outgoing.get(edge.from)?.add(edge.to);
  }
  return files.map((file) => ({
    ...file,
    fanIn: incoming.get(file.path)?.size ?? 0,
    fanOut: outgoing.get(file.path)?.size ?? 0,
  }));
}
