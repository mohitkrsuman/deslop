import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RepositoryListing } from "../types.mts";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;

// Folders ("" for the repository root) whose package.json declares any of the
// named packages. A package.json that can't be read or parsed declares nothing.
export async function packageRootsDeclaring(repository: RepositoryListing, packages: string[]): Promise<string[]> {
  const roots: string[] = [];
  for (const file of repository.otherPaths) {
    if (file !== "package.json" && !file.endsWith("/package.json")) continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(path.join(repository.root, file), "utf8"));
    } catch {
      continue;
    }
    if (typeof manifest !== "object" || manifest === null) continue;
    const declared = DEPENDENCY_FIELDS.some((field) => {
      const entries: unknown = (manifest as Record<string, unknown>)[field];
      return typeof entries === "object" && entries !== null && packages.some((name) => name in entries);
    });
    if (declared) roots.push(file === "package.json" ? "" : file.slice(0, -"/package.json".length));
  }
  return roots;
}

// The deepest package root containing the file, or null if none does.
export function packageRootOf(file: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if ((root === "" || file.startsWith(`${root}/`)) && (best === null || root.length > best.length)) best = root;
  }
  return best;
}

// The file's path inside its package root.
export function withinRoot(file: string, root: string): string {
  return root === "" ? file : file.slice(root.length + 1);
}
