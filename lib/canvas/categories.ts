import type { FileNode } from "../parser/types.mts";
import { taxonomyFor } from "../taxonomy.mts";
import type { RoleSection } from "../taxonomy.mts";
import type { Folding } from "./fold.ts";

export const CATEGORY_SECTION_PREFIX = "section:";

export interface CategoryFilter {
  role: string;
  paths: ReadonlySet<string>;
  counts: ReadonlyMap<string, number>;
}

// Counts cover every member of a folded group, including offscreen panel rows.
export function categoryFilterFor(files: FileNode[], folding: Folding, role: string | null, adapter?: string): CategoryFilter | null {
  if (role === null) return null;
  const roles = role.startsWith(CATEGORY_SECTION_PREFIX)
    ? new Set(taxonomyFor(adapter ?? "").categories
      .filter((category) => category.section === role.slice(CATEGORY_SECTION_PREFIX.length))
      .map((category) => category.role))
    : new Set([role]);
  const paths = new Set(files.filter((file) => roles.has(file.kind)).map((file) => file.path));
  const counts = new Map(folding.groups.map((group) => [group.folder, group.files.filter((path) => paths.has(path)).length]));
  return { role, paths, counts };
}

export interface Category {
  role: string;
  label: string;
  section: RoleSection;
  count: number;
  // CSS colour for this role, or null: only the roles worth scanning for get one.
  color: string | null;
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "(no extension)";
}

// Every role the adapter knows, in its fixed reading order, empty ones
// included, so a category is always found in the same place. Files are
// expected to carry roles already normalised against this adapter.
export function categoriesOf(files: FileNode[], adapter: string): Category[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  return taxonomyFor(adapter).categories.map((category) => ({
    role: category.role,
    label: category.label,
    section: category.section,
    count: counts.get(category.role) ?? 0,
    color: category.hue ? `var(--kind-${category.hue})` : null,
  }));
}
