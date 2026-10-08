import { GENERIC_ROLES, REACT_ROLES } from "../../taxonomy.mts";
import type { AdapterRun, RepositoryAdapter } from "../types.mts";
import { genericRole } from "./generic.mts";
import { packageRootsDeclaring } from "./package-roots.mts";

const JSX_FILE = /\.[jt]sx$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_NAME = /^use[A-Z0-9]/;

// React conventions from the path alone: a hook is a file named use<Something>
// or kept in a hooks folder; a component is a JSX file with a PascalCase name
// or kept in a components folder. Anything else gets a generic role.
export function reactRole(path: string): string {
  const generic = genericRole(path);
  if (generic !== GENERIC_ROLES.other) return generic;
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  const stem = name.slice(0, name.indexOf("."));
  const folders = segments.slice(0, -1);
  if (HOOK_NAME.test(stem) || folders.includes("hooks")) return REACT_ROLES.hook;
  if (JSX_FILE.test(name) && (PASCAL_CASE.test(stem) || folders.includes("components"))) return REACT_ROLES.component;
  return generic;
}

export const reactAdapter: RepositoryAdapter = {
  name: "react",
  async detect(repository): Promise<AdapterRun | null> {
    const roots = await packageRootsDeclaring(repository, ["react"]);
    if (roots.length === 0) return null;
    return {
      name: "react",
      roleOf: (file) => reactRole(file.path),
      finish: () => ({ routes: [], notes: ["React has no routing convention in the syntax, so no routes were extracted."] }),
    };
  },
};
