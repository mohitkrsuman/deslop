import type { FileNode } from "../parser/types.mts";
import type { Folding } from "./fold.ts";

export interface CategoryFilter {
  extension: string;
  paths: ReadonlySet<string>;
  counts: ReadonlyMap<string, number>;
}

// Counts cover every member of a folded group, including offscreen panel rows.
export function categoryFilterFor(files: FileNode[], folding: Folding, extension: string | null): CategoryFilter | null {
  if (extension === null) return null;
  const paths = new Set(files.filter((file) => extensionOf(file.path) === extension).map((file) => file.path));
  const counts = new Map(folding.groups.map((group) => [group.folder, group.files.filter((path) => paths.has(path)).length]));
  return { extension, paths, counts };
}

export interface Category {
  extension: string;
  count: number;
  // CSS colour for this extension. Six hues; a seventh shares one.
  color: string;
}

const PALETTE_SIZE = 6;

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "(no extension)";
}

// Group files by extension, largest first, ties by name.
export function categoriesOf(files: FileNode[]): Category[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = extensionOf(file.path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftExtension, left], [rightExtension, right]) => right - left || leftExtension.localeCompare(rightExtension))
    .map(([extension, count], index) => ({ extension, count, color: `var(--kind-${(index % PALETTE_SIZE) + 1})` }));
}
