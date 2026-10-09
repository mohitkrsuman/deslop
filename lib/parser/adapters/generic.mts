import { APPLICATION_ROLES, GENERIC_ADAPTER, GENERIC_ROLES } from "../../taxonomy.mts";
import type { AdapterRun } from "../types.mts";

const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_FOLDER = /(?:^|\/)__tests__\//;
const DECLARATION = /\.d\.[cm]?ts$/;
const CONFIG = /(?:^|[.\-])config(?:[.\-][^.]+)*\.[cm]?[jt]s$/;
const RC_FILE = /^\..+rc\.[cm]?[jt]s$/;

const FILE_SUFFIX_ROLES: Record<string, string> = {
  route: APPLICATION_ROLES.route,
  page: APPLICATION_ROLES.route,
  handler: APPLICATION_ROLES.route,
  controller: APPLICATION_ROLES.controller,
  gateway: APPLICATION_ROLES.gateway,
  resolver: APPLICATION_ROLES.resolver,
  service: APPLICATION_ROLES.service,
  repository: APPLICATION_ROLES.repository,
  repo: APPLICATION_ROLES.repository,
  module: APPLICATION_ROLES.module,
  model: APPLICATION_ROLES.model,
  entity: APPLICATION_ROLES.entity,
  schema: APPLICATION_ROLES.schema,
  dto: APPLICATION_ROLES.dto,
  guard: APPLICATION_ROLES.guard,
  interceptor: APPLICATION_ROLES.interceptor,
  pipe: APPLICATION_ROLES.pipe,
  filter: APPLICATION_ROLES.filter,
  middleware: APPLICATION_ROLES.middleware,
  decorator: APPLICATION_ROLES.decorator,
  strategy: APPLICATION_ROLES.strategy,
  component: APPLICATION_ROLES.component,
  hook: APPLICATION_ROLES.hook,
};

const FOLDER_ROLES: Record<string, string> = {
  test: GENERIC_ROLES.test,
  tests: GENERIC_ROLES.test,
  spec: GENERIC_ROLES.test,
  specs: GENERIC_ROLES.test,
  config: GENERIC_ROLES.config,
  configs: GENERIC_ROLES.config,
  type: GENERIC_ROLES.typeDeclaration,
  types: GENERIC_ROLES.typeDeclaration,
  interface: GENERIC_ROLES.typeDeclaration,
  interfaces: GENERIC_ROLES.typeDeclaration,
  route: APPLICATION_ROLES.route,
  routes: APPLICATION_ROLES.route,
  page: APPLICATION_ROLES.route,
  pages: APPLICATION_ROLES.route,
  router: APPLICATION_ROLES.route,
  routers: APPLICATION_ROLES.route,
  api: APPLICATION_ROLES.route,
  apis: APPLICATION_ROLES.route,
  endpoint: APPLICATION_ROLES.route,
  endpoints: APPLICATION_ROLES.route,
  handler: APPLICATION_ROLES.route,
  handlers: APPLICATION_ROLES.route,
  controller: APPLICATION_ROLES.controller,
  controllers: APPLICATION_ROLES.controller,
  gateway: APPLICATION_ROLES.gateway,
  gateways: APPLICATION_ROLES.gateway,
  resolver: APPLICATION_ROLES.resolver,
  resolvers: APPLICATION_ROLES.resolver,
  service: APPLICATION_ROLES.service,
  services: APPLICATION_ROLES.service,
  repository: APPLICATION_ROLES.repository,
  repositories: APPLICATION_ROLES.repository,
  repo: APPLICATION_ROLES.repository,
  repos: APPLICATION_ROLES.repository,
  module: APPLICATION_ROLES.module,
  modules: APPLICATION_ROLES.module,
  model: APPLICATION_ROLES.model,
  models: APPLICATION_ROLES.model,
  entity: APPLICATION_ROLES.entity,
  entities: APPLICATION_ROLES.entity,
  schema: APPLICATION_ROLES.schema,
  schemas: APPLICATION_ROLES.schema,
  dto: APPLICATION_ROLES.dto,
  dtos: APPLICATION_ROLES.dto,
  guard: APPLICATION_ROLES.guard,
  guards: APPLICATION_ROLES.guard,
  interceptor: APPLICATION_ROLES.interceptor,
  interceptors: APPLICATION_ROLES.interceptor,
  pipe: APPLICATION_ROLES.pipe,
  pipes: APPLICATION_ROLES.pipe,
  filter: APPLICATION_ROLES.filter,
  filters: APPLICATION_ROLES.filter,
  middleware: APPLICATION_ROLES.middleware,
  middlewares: APPLICATION_ROLES.middleware,
  decorator: APPLICATION_ROLES.decorator,
  decorators: APPLICATION_ROLES.decorator,
  strategy: APPLICATION_ROLES.strategy,
  strategies: APPLICATION_ROLES.strategy,
  component: APPLICATION_ROLES.component,
  components: APPLICATION_ROLES.component,
  view: APPLICATION_ROLES.component,
  views: APPLICATION_ROLES.component,
  screen: APPLICATION_ROLES.component,
  screens: APPLICATION_ROLES.component,
  hook: APPLICATION_ROLES.hook,
  hooks: APPLICATION_ROLES.hook,
  util: APPLICATION_ROLES.utility,
  utils: APPLICATION_ROLES.utility,
  utility: APPLICATION_ROLES.utility,
  utilities: APPLICATION_ROLES.utility,
  helper: APPLICATION_ROLES.utility,
  helpers: APPLICATION_ROLES.utility,
};

function conventionRole(path: string, name: string): string | null {
  const stem = name.slice(0, name.lastIndexOf("."));
  const suffix = stem.slice(stem.lastIndexOf(".") + 1).toLowerCase();
  const bySuffix = FILE_SUFFIX_ROLES[suffix];
  if (bySuffix) return bySuffix;

  const folders = path.split("/").slice(0, -1).reverse();
  for (const folder of folders) {
    const byFolder = FOLDER_ROLES[folder.toLowerCase()];
    if (byFolder) return byFolder;
  }
  return null;
}

// Shared application roles come from conventional file suffixes and folder
// names. Framework adapters override these when they have a more precise role.
export function genericRole(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (TEST.test(name) || TEST_FOLDER.test(path)) return GENERIC_ROLES.test;
  if (DECLARATION.test(name)) return GENERIC_ROLES.typeDeclaration;
  if (CONFIG.test(name) || RC_FILE.test(name)) return GENERIC_ROLES.config;
  return conventionRole(path, name) ?? GENERIC_ROLES.other;
}

// Used when no framework adapter matched: generic roles and no routes.
export function genericRun(): AdapterRun {
  return {
    name: GENERIC_ADAPTER,
    roleOf: (file) => genericRole(file.path),
    finish: () => ({ routes: [], notes: ["No framework adapter matched this repository, so no routes were extracted."] }),
  };
}
