import { GENERIC_ROLES } from "../../taxonomy.mts";
import type { AdapterRun, RepositoryAdapter } from "../types.mts";
import { genericFolderRole, genericRole } from "./generic.mts";
import { packageRootOf, packageRootsDeclaring } from "./package-roots.mts";

// Express builds routes from runtime router and middleware calls, so the
// adapter reports file roles and leaves the route table empty.
export const expressAdapter: RepositoryAdapter = {
  name: "express",
  async detect(repository): Promise<AdapterRun | null> {
    const roots = await packageRootsDeclaring(repository, ["express"]);
    if (roots.length === 0) return null;
    return {
      name: "express",
      roleOf(file) {
        if (packageRootOf(file.path, roots) === null) return genericRole(file.path);
        const generic = genericRole(file.path);
        if (generic === GENERIC_ROLES.test || generic === GENERIC_ROLES.typeDeclaration ||
            generic === GENERIC_ROLES.config) return generic;
        return genericFolderRole(file.path) ?? GENERIC_ROLES.other;
      },
      finish: () => ({
        routes: [],
        notes: ["Express routes are assembled at runtime, so no routes were extracted."],
      }),
    };
  },
};
