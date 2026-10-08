import type { Edge, FileNode } from "../parser/types.mts";

export interface GraphIndex {
  dependencies: Map<string, string[]>;
  dependents: Map<string, string[]>;
}

export type WalkDirection = "dependents" | "dependencies";
export interface ReachableFile {
  path: string;
  depth: number;
  // The previous file on a shortest path from the selected file.
  via: string;
}

export function buildGraphIndex(files: FileNode[], edges: Edge[]): GraphIndex {
  const dependencies = new Map(files.map((file) => [file.path, new Set<string>()]));
  const dependents = new Map(files.map((file) => [file.path, new Set<string>()]));
  for (const { from, to } of edges) {
    if (!dependencies.has(from) || !dependencies.has(to)) continue;
    dependencies.get(from)!.add(to);
    dependents.get(to)!.add(from);
  }
  const lists = (map: Map<string, Set<string>>) =>
    new Map([...map].map(([path, neighbours]) => [path, [...neighbours].sort()]));
  return { dependencies: lists(dependencies), dependents: lists(dependents) };
}

// One breadth-first walk for both directions. First visit gives the shortest
// distance; the starting file never appears in its own result, even in a cycle.
export function walkGraph(
  graph: GraphIndex,
  start: string,
  direction: WalkDirection,
  depthLimit = 2,
): ReachableFile[] {
  if (!Number.isInteger(depthLimit) || depthLimit < 0) throw new RangeError("Depth must be a non-negative integer.");
  const adjacency = graph[direction];
  if (!adjacency.has(start)) return [];
  const seen = new Set([start]);
  const queue = [{ path: start, depth: 0 }];
  const results: ReachableFile[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.depth >= depthLimit) continue;
    for (const path of adjacency.get(current.path) ?? []) {
      if (seen.has(path)) continue;
      seen.add(path);
      const next = { path, depth: current.depth + 1, via: current.path };
      results.push(next);
      queue.push(next);
    }
  }
  return results.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
}

export interface ImportCycle {
  files: string[];
  // A closed, ordered walk: every adjacent pair is an actual import.
  path: string[];
}

// Iterative Kosaraju: one result per cyclic strongly connected component.
// Enumerating every possible cycle would be exponential in a dense repository.
export function findImportCycles(graph: GraphIndex): ImportCycle[] {
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const start of [...graph.dependencies.keys()].sort()) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [{ path: start, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbours = graph.dependencies.get(frame.path) ?? [];
      if (frame.next === neighbours.length) {
        finished.push(frame.path);
        stack.pop();
      } else {
        const next = neighbours[frame.next++];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ path: next, next: 0 });
        }
      }
    }
  }

  visited.clear();
  const cycles: ImportCycle[] = [];
  for (let i = finished.length - 1; i >= 0; i -= 1) {
    const start = finished[i];
    if (visited.has(start)) continue;
    const files: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const path = stack.pop()!;
      files.push(path);
      for (const next of graph.dependents.get(path) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    if (files.length > 1 || graph.dependencies.get(start)?.includes(start)) {
      files.sort();
      cycles.push({ files, path: cycleWitness(graph, files) });
    }
  }
  return cycles.sort((a, b) => a.files[0].localeCompare(b.files[0]));
}

function cycleWitness(graph: GraphIndex, files: string[]): string[] {
  const members = new Set(files);
  const seen = new Set([files[0]]);
  const active = new Map([[files[0], 0]]);
  const stack = [{ path: files[0], next: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const neighbours = graph.dependencies.get(frame.path) ?? [];
    if (frame.next === neighbours.length) {
      active.delete(frame.path);
      stack.pop();
      continue;
    }
    const next = neighbours[frame.next++];
    if (!members.has(next)) continue;
    const position = active.get(next);
    if (position !== undefined) return [...stack.slice(position).map((item) => item.path), next];
    if (!seen.has(next)) {
      seen.add(next);
      active.set(next, stack.length);
      stack.push({ path: next, next: 0 });
    }
  }
  return [];
}
