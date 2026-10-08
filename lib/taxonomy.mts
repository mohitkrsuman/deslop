// The role names each adapter may assign, in rail order. This file imports
// nothing so the browser can read category names without pulling a parser and
// filesystem code into the bundle. Adapters import their role ids from here,
// which keeps the two from drifting apart.

export interface RoleCategory {
  role: string;
  label: string;
  // Index into the six --kind-N hues. Only the roles someone scans for get one;
  // a seventh colour would stop meaning anything.
  hue?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface Taxonomy {
  // Shown in the interface; null when no adapter matched.
  framework: string | null;
  categories: readonly RoleCategory[];
}

// Name the parser records when no framework adapter matched.
export const GENERIC_ADAPTER = "fallback";

// Every repository ends with these, framework or not: plumbing last.
export const GENERIC_ROLES = {
  test: "test",
  typeDeclaration: "type-declaration",
  config: "config",
  other: "other",
} as const;

const GENERIC_CATEGORIES: readonly RoleCategory[] = [
  { role: GENERIC_ROLES.test, label: "Tests" },
  { role: GENERIC_ROLES.typeDeclaration, label: "Type declarations" },
  { role: GENERIC_ROLES.config, label: "Config" },
  { role: GENERIC_ROLES.other, label: "Other modules" },
];

export const REACT_ROLES = {
  component: "component",
  hook: "hook",
} as const;

export const NEXTJS_ROLES = {
  page: "page",
  apiRoute: "api-route",
  serverAction: "server-action",
  layout: "layout",
  routeUi: "route-ui",
  metadata: "metadata",
  middleware: "middleware",
  ...REACT_ROLES,
} as const;

export const NESTJS_ROLES = {
  controller: "controller",
  gateway: "gateway",
  resolver: "resolver",
  service: "service",
  repository: "repository",
  module: "module",
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
} as const;

// Reading order: what a request reaches first, then the layers behind it,
// then plumbing. Fixed, so a repository's categories never trade places.
const TAXONOMIES: Record<string, Taxonomy> = {
  nextjs: {
    framework: "Next.js",
    categories: [
      { role: NEXTJS_ROLES.page, label: "Page routes", hue: 1 },
      { role: NEXTJS_ROLES.apiRoute, label: "API endpoints", hue: 2 },
      { role: NEXTJS_ROLES.serverAction, label: "Server actions", hue: 3 },
      { role: NEXTJS_ROLES.layout, label: "Layouts", hue: 4 },
      { role: NEXTJS_ROLES.routeUi, label: "Loading and error UI" },
      { role: NEXTJS_ROLES.metadata, label: "Metadata files" },
      { role: NEXTJS_ROLES.middleware, label: "Middleware" },
      { role: NEXTJS_ROLES.component, label: "Components", hue: 5 },
      { role: NEXTJS_ROLES.hook, label: "Hooks", hue: 6 },
      ...GENERIC_CATEGORIES,
    ],
  },
  nestjs: {
    framework: "NestJS",
    categories: [
      { role: NESTJS_ROLES.controller, label: "Controllers", hue: 1 },
      { role: NESTJS_ROLES.gateway, label: "Gateways" },
      { role: NESTJS_ROLES.resolver, label: "Resolvers" },
      { role: NESTJS_ROLES.service, label: "Services", hue: 2 },
      { role: NESTJS_ROLES.repository, label: "Repositories" },
      { role: NESTJS_ROLES.module, label: "Modules", hue: 3 },
      { role: NESTJS_ROLES.entity, label: "Entities", hue: 4 },
      { role: NESTJS_ROLES.schema, label: "Schemas" },
      { role: NESTJS_ROLES.dto, label: "DTOs", hue: 5 },
      { role: NESTJS_ROLES.guard, label: "Guards", hue: 6 },
      { role: NESTJS_ROLES.interceptor, label: "Interceptors" },
      { role: NESTJS_ROLES.pipe, label: "Pipes" },
      { role: NESTJS_ROLES.filter, label: "Filters" },
      { role: NESTJS_ROLES.middleware, label: "Middleware" },
      { role: NESTJS_ROLES.decorator, label: "Decorators" },
      { role: NESTJS_ROLES.strategy, label: "Strategies" },
      ...GENERIC_CATEGORIES,
    ],
  },
  react: {
    framework: "React",
    categories: [
      { role: REACT_ROLES.component, label: "Components", hue: 1 },
      { role: REACT_ROLES.hook, label: "Hooks", hue: 2 },
      ...GENERIC_CATEGORIES,
    ],
  },
};

const GENERIC_TAXONOMY: Taxonomy = { framework: null, categories: GENERIC_CATEGORIES };

export function taxonomyFor(adapter: string): Taxonomy {
  return TAXONOMIES[adapter] ?? GENERIC_TAXONOMY;
}

// A stored role the adapter's taxonomy doesn't list (an analysis from before
// adapters existed, say) is shown as unidentified rather than given a name.
export function normalizeRole(adapter: string, role: string): string {
  return taxonomyFor(adapter).categories.some((category) => category.role === role) ? role : GENERIC_ROLES.other;
}
