import type { FileNode } from "../parser/types.mts";

export interface Category {
  kind: string;
  count: number;
  // CSS colour for this kind. Six hues; a seventh kind would share one, which
  // is the point to stop adding kinds rather than hues.
  color: string;
}

const PALETTE_SIZE = 6;

// Groups files by the kind the adapter gave them, largest first, ties by name,
// so a kind keeps its colour for a given repository.
export function categoriesOf(files: FileNode[]): Category[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([leftKind, left], [rightKind, right]) => right - left || leftKind.localeCompare(rightKind))
    .map(([kind, count], index) => ({ kind, count, color: `var(--kind-${(index % PALETTE_SIZE) + 1})` }));
}
