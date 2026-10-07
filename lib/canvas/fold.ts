import type { FileNode } from "../parser/types.mts";

export interface FoldedGroup {
  // The directory this node stands for; "." is the repository root.
  folder: string;
  // Every file now owned by the node, its own and any merged in from below.
  files: string[];
}

export interface Folding {
  threshold: number;
  groups: FoldedGroup[];
  groupOf: Map<string, string>;
}

// Roughly two dozen is where a map stops being readable at a glance.
export const MAX_FOLDED_NODES = 24;

// The parent directory of a folder, or null for the root.
function parentOf(folder: string): string | null {
  if (folder === ".") return null;
  const slash = folder.lastIndexOf("/");
  return slash < 0 ? "." : folder.slice(0, slash);
}

function depthOf(folder: string): number {
  return folder === "." ? 0 : folder.split("/").length;
}

// One folding pass at a fixed threshold. Every directory, including ones that
// only hold other directories, starts as its own node. Working deepest first,
// a directory holding fewer than `threshold` files merges into its parent.
// Each depth decides all of its merges before applying any, so no merge at a
// depth changes what another merge at that same depth sees.
function foldAt(files: FileNode[], threshold: number): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const file of files) {
    for (let folder: string | null = file.folder; folder !== null; folder = parentOf(folder)) {
      if (!members.has(folder)) members.set(folder, []);
    }
    members.get(file.folder)?.push(file.path);
  }

  const deepest = Math.max(0, ...[...members.keys()].map(depthOf));
  for (let depth = deepest; depth > 0; depth -= 1) {
    const merging = [...members.entries()]
      .filter(([folder, owned]) => depthOf(folder) === depth && owned.length < threshold)
      .map(([folder]) => folder);
    for (const folder of merging) {
      const parent = parentOf(folder);
      const owned = members.get(folder);
      if (parent === null || !owned) continue;
      members.get(parent)?.push(...owned);
      members.delete(folder);
    }
  }

  // A directory left with no files of its own isn't something to draw.
  for (const [folder, owned] of members) {
    if (owned.length === 0) members.delete(folder);
  }
  return members;
}

// Folds the file list into readable nodes. The threshold starts at two and
// rises one at a time, stopping at the lowest value that lands at or under
// MAX_FOLDED_NODES, so the repository's own shape decides how deep the map
// goes. Nothing about depth is picked in advance.
export function foldDirectories(files: FileNode[], maxNodes = MAX_FOLDED_NODES): Folding {
  let threshold = 2;
  let members = foldAt(files, threshold);
  while (members.size > maxNodes && threshold <= files.length) {
    threshold += 1;
    members = foldAt(files, threshold);
  }

  const groups = [...members.entries()]
    .map(([folder, owned]) => ({ folder, files: [...owned].sort() }))
    .sort((left, right) => left.folder.localeCompare(right.folder));
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const file of group.files) groupOf.set(file, group.folder);
  }
  return { threshold, groups, groupOf };
}
