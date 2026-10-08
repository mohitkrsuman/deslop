import { GENERIC_ADAPTER, GENERIC_ROLES } from "../../taxonomy.mts";
import type { AdapterRun } from "../types.mts";

const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_FOLDER = /(?:^|\/)__tests__\//;
const DECLARATION = /\.d\.[cm]?ts$/;
const CONFIG = /(?:^|[.\-])config(?:[.\-][^.]+)*\.[cm]?[jt]s$/;
const RC_FILE = /^\..+rc\.[cm]?[jt]s$/;

// Roles any JavaScript repository has, read from file names alone. Framework
// adapters fall back to this for files their conventions don't cover.
export function genericRole(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (TEST.test(name) || TEST_FOLDER.test(path)) return GENERIC_ROLES.test;
  if (DECLARATION.test(name)) return GENERIC_ROLES.typeDeclaration;
  if (CONFIG.test(name) || RC_FILE.test(name)) return GENERIC_ROLES.config;
  return GENERIC_ROLES.other;
}

// Used when no framework adapter matched: generic roles and no routes.
export function genericRun(): AdapterRun {
  return {
    name: GENERIC_ADAPTER,
    roleOf: (file) => genericRole(file.path),
    finish: () => ({ routes: [], notes: ["No framework adapter matched this repository, so no routes were extracted."] }),
  };
}
