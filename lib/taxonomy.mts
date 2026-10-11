// The role names each adapter may assign, in rail order. This file imports
// nothing so the browser can read category names without pulling a parser and
// filesystem code into the bundle. Adapters import their role ids from here,
// which keeps the two from drifting apart.

export interface RoleCategory {
  role: string;
  label: string;
  section: RoleSection;
  // Index into the six --kind-N hues. Only the roles someone scans for get one;
  // a seventh colour would stop meaning anything.
  hue?: 1 | 2 | 3 | 4 | 5 | 6;
}

export const ROLE_SECTIONS = {
  routes: "Routes",
  controllers: "Controllers",
  application: "Services and modules",
  models: "Models",
  shared: "Components and hooks",
  repository: "Other files",
} as const;

export type RoleSection = keyof typeof ROLE_SECTIONS;

export interface Taxonomy {
  // Shown in the interface; null when no adapter matched.
  framework: string | null;
  categories: readonly RoleCategory[];
}

// Name the parser records when no framework adapter matched.
export const GENERIC_ADAPTER = "fallback";

// Roles shared by common application folder and file-name conventions.
export const APPLICATION_ROLES = {
  route: "route",
  controller: "controller",
  gateway: "gateway",
  resolver: "resolver",
  service: "service",
  repository: "repository",
  module: "module",
  utility: "utility",
  model: "model",
  entity: "entity",
  schema: "schema",
  dto: "dto",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "filter",
  middleware: "middleware",
  decorator: "decorator",
  strategy: "strategy",
  component: "component",
  hook: "hook",
} as const;

// Shared application and repository role ids used by every adapter.
export const GENERIC_ROLES = {
  ...APPLICATION_ROLES,
  test: "test",
  typeDeclaration: "type-declaration",
  config: "config",
  other: "other",
} as const;

// The only roles a model may give a file no adapter identified. Page, route and
// controller decide the route table and entry-point colouring, so convention
// alone owns them. Every taxonomy lists all of these.
export const MODEL_ASSIGNABLE_ROLES = [
  APPLICATION_ROLES.service,
  APPLICATION_ROLES.repository,
  APPLICATION_ROLES.model,
  APPLICATION_ROLES.utility,
  GENERIC_ROLES.config,
  APPLICATION_ROLES.component,
  APPLICATION_ROLES.hook,
] as const;

export type ModelAssignableRole = typeof MODEL_ASSIGNABLE_ROLES[number];

export function isModelAssignableRole(role: string): role is ModelAssignableRole {
  return (MODEL_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

const GENERIC_CATEGORIES: readonly RoleCategory[] = [
  { role: GENERIC_ROLES.test, label: "Tests", section: "repository" },
  { role: GENERIC_ROLES.typeDeclaration, label: "Type declarations", section: "repository" },
  { role: GENERIC_ROLES.config, label: "Config", section: "repository" },
  { role: GENERIC_ROLES.other, label: "Other files", section: "repository" },
];

const ROUTE_CATEGORIES: readonly RoleCategory[] = [
  { role: APPLICATION_ROLES.route, label: "Route files", section: "routes" },
];

const CONTROLLER_CATEGORIES: readonly RoleCategory[] = [
  { role: APPLICATION_ROLES.controller, label: "Controllers", section: "controllers", hue: 1 },
  { role: APPLICATION_ROLES.gateway, label: "Gateways", section: "controllers" },
  { role: APPLICATION_ROLES.resolver, label: "Resolvers", section: "controllers" },
];

const APPLICATION_CATEGORIES: readonly RoleCategory[] = [
  { role: APPLICATION_ROLES.service, label: "Services", section: "application", hue: 2 },
  { role: APPLICATION_ROLES.repository, label: "Repositories", section: "application" },
  { role: APPLICATION_ROLES.module, label: "Modules", section: "application", hue: 3 },
  { role: APPLICATION_ROLES.utility, label: "Utilities", section: "application" },
  { role: APPLICATION_ROLES.dto, label: "DTOs", section: "application", hue: 5 },
  { role: APPLICATION_ROLES.guard, label: "Guards", section: "application", hue: 6 },
  { role: APPLICATION_ROLES.interceptor, label: "Interceptors", section: "application" },
  { role: APPLICATION_ROLES.pipe, label: "Pipes", section: "application" },
  { role: APPLICATION_ROLES.filter, label: "Filters", section: "application" },
  { role: APPLICATION_ROLES.middleware, label: "Middleware", section: "application" },
  { role: APPLICATION_ROLES.decorator, label: "Decorators", section: "application" },
  { role: APPLICATION_ROLES.strategy, label: "Strategies", section: "application" },
];

const MODEL_CATEGORIES: readonly RoleCategory[] = [
  { role: APPLICATION_ROLES.model, label: "Models", section: "models" },
  { role: APPLICATION_ROLES.entity, label: "Entities", section: "models", hue: 4 },
  { role: APPLICATION_ROLES.schema, label: "Schemas", section: "models" },
];

const SHARED_CATEGORIES: readonly RoleCategory[] = [
  { role: APPLICATION_ROLES.component, label: "Components", section: "shared", hue: 5 },
  { role: APPLICATION_ROLES.hook, label: "Hooks", section: "shared", hue: 6 },
];

export const REACT_ROLES = {
  component: APPLICATION_ROLES.component,
  hook: APPLICATION_ROLES.hook,
} as const;

export const NEXTJS_ROLES = {
  page: "page",
  apiRoute: "api-route",
  serverAction: "server-action",
  layout: "layout",
  routeUi: "route-ui",
  metadata: "metadata",
  middleware: APPLICATION_ROLES.middleware,
  ...REACT_ROLES,
} as const;

export const NESTJS_ROLES = {
  controller: APPLICATION_ROLES.controller,
  gateway: APPLICATION_ROLES.gateway,
  resolver: APPLICATION_ROLES.resolver,
  service: APPLICATION_ROLES.service,
  repository: APPLICATION_ROLES.repository,
  module: APPLICATION_ROLES.module,
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
} as const;

// Reading order: what a request reaches first, then the layers behind it,
// then plumbing. Fixed, so a repository's categories never trade places.
const TAXONOMIES: Record<string, Taxonomy> = {
  nextjs: {
    framework: "Next.js",
    categories: [
      { role: NEXTJS_ROLES.page, label: "Page routes", section: "routes", hue: 1 },
      { role: NEXTJS_ROLES.apiRoute, label: "API endpoints", section: "routes", hue: 2 },
      { role: NEXTJS_ROLES.serverAction, label: "Server actions", section: "routes", hue: 3 },
      ...ROUTE_CATEGORIES,
      ...CONTROLLER_CATEGORIES,
      { role: NEXTJS_ROLES.layout, label: "Layouts", section: "application", hue: 4 },
      { role: NEXTJS_ROLES.routeUi, label: "Loading and error UI", section: "application" },
      { role: NEXTJS_ROLES.metadata, label: "Metadata files", section: "application" },
      ...APPLICATION_CATEGORIES,
      ...MODEL_CATEGORIES,
      ...SHARED_CATEGORIES,
      ...GENERIC_CATEGORIES,
    ],
  },
  nestjs: {
    framework: "NestJS",
    categories: [
      ...ROUTE_CATEGORIES,
      ...CONTROLLER_CATEGORIES,
      ...APPLICATION_CATEGORIES,
      ...MODEL_CATEGORIES,
      ...SHARED_CATEGORIES,
      ...GENERIC_CATEGORIES,
    ],
  },
  express: {
    framework: "Express",
    categories: [
      ...ROUTE_CATEGORIES,
      ...CONTROLLER_CATEGORIES,
      ...APPLICATION_CATEGORIES,
      ...MODEL_CATEGORIES,
      ...SHARED_CATEGORIES,
      ...GENERIC_CATEGORIES,
    ],
  },
  react: {
    framework: "React",
    categories: [
      ...ROUTE_CATEGORIES,
      ...CONTROLLER_CATEGORIES,
      ...APPLICATION_CATEGORIES,
      ...MODEL_CATEGORIES,
      ...SHARED_CATEGORIES,
      ...GENERIC_CATEGORIES,
    ],
  },
};

const GENERIC_TAXONOMY: Taxonomy = {
  framework: null,
  categories: [
    ...ROUTE_CATEGORIES,
    ...CONTROLLER_CATEGORIES,
    ...APPLICATION_CATEGORIES,
    ...MODEL_CATEGORIES,
    ...SHARED_CATEGORIES,
    ...GENERIC_CATEGORIES,
  ],
};

export function taxonomyFor(adapter: string): Taxonomy {
  return TAXONOMIES[adapter] ?? GENERIC_TAXONOMY;
}

// A stored role the adapter's taxonomy doesn't list (an analysis from before
// adapters existed, say) is shown as unidentified rather than given a name.
export function normalizeRole(adapter: string, role: string): string {
  return taxonomyFor(adapter).categories.some((category) => category.role === role) ? role : GENERIC_ROLES.other;
}
