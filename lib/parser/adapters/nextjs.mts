import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { GENERIC_ROLES, NEXTJS_ROLES } from "../../taxonomy.mts";
import type { AdapterFile, AdapterRun, RepositoryAdapter, RepositoryListing, Route } from "../types.mts";
import { genericRole } from "./generic.mts";
import { packageRootOf, packageRootsDeclaring, withinRoot } from "./package-roots.mts";
import { reactRole } from "./react.mts";

const ROUTABLE = /\.(?:jsx?|tsx?)$/;
const CONFIG_FILE = /^next\.config\.(?:[cm]?js|[cm]?ts)$/;
const ROOT_MIDDLEWARE = /^(?:src\/)?(?:middleware|proxy)\.(?:jsx?|tsx?)$/;
const ROOT_INSTRUMENTATION = /^(?:src\/)?instrumentation(?:-client)?\.(?:jsx?|tsx?)$/;
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);

const APP_FILES: Record<string, string> = {
  page: NEXTJS_ROLES.page,
  route: NEXTJS_ROLES.apiRoute,
  layout: NEXTJS_ROLES.layout,
  template: NEXTJS_ROLES.layout,
  loading: NEXTJS_ROLES.routeUi,
  error: NEXTJS_ROLES.routeUi,
  "global-error": NEXTJS_ROLES.routeUi,
  "not-found": NEXTJS_ROLES.routeUi,
  forbidden: NEXTJS_ROLES.routeUi,
  unauthorized: NEXTJS_ROLES.routeUi,
  default: NEXTJS_ROLES.routeUi,
  sitemap: NEXTJS_ROLES.metadata,
  robots: NEXTJS_ROLES.metadata,
  manifest: NEXTJS_ROLES.metadata,
  icon: NEXTJS_ROLES.metadata,
  "apple-icon": NEXTJS_ROLES.metadata,
  "opengraph-image": NEXTJS_ROLES.metadata,
  "twitter-image": NEXTJS_ROLES.metadata,
};

interface NextApp {
  root: string;
  // Folder of the app router inside the root, e.g. "app" or "src/app".
  appDir: string | null;
  pagesDir: string | null;
  // The literal basePath, "" when unset, or null when it can't be read exactly.
  basePath: string | null;
}

function hasFilesUnder(repository: RepositoryListing, folder: string): boolean {
  return repository.sourcePaths.some((file) => file.startsWith(`${folder}/`));
}

// Next.js prefers a root app/ (or pages/) folder and only uses src/ without one.
function routerDir(repository: RepositoryListing, root: string, name: string): string | null {
  const prefix = root === "" ? "" : `${root}/`;
  if (hasFilesUnder(repository, `${prefix}${name}`)) return name;
  if (hasFilesUnder(repository, `${prefix}src/${name}`)) return `src/${name}`;
  return null;
}

// Reads basePath from next.config. Only a string literal counts. A config
// that sets it any other way makes every route pattern for that app unknown.
async function readBasePath(repository: RepositoryListing, root: string, notes: string[]): Promise<string | null> {
  const configs = repository.sourcePaths.filter((file) =>
    packageRootOf(file, [root]) === root && CONFIG_FILE.test(withinRoot(file, root)));
  if (configs.length === 0) return "";
  if (configs.length > 1) {
    notes.push(`${configs.join(", ")}: more than one Next.js config, so the basePath is unknown and no routes were extracted for this app.`);
    return null;
  }
  const configPath = configs[0];
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(configPath, await readFile(path.join(repository.root, configPath), "utf8"), ts.ScriptTarget.Latest, true);
  } catch (error) {
    notes.push(`${configPath}: could not be read (${String(error)}), so no routes were extracted for this app.`);
    return null;
  }
  const values: (string | null)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "basePath" ||
        ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === "basePath") {
      values.push(ts.isStringLiteralLike(node.initializer) ? node.initializer.text : null);
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "basePath") {
      values.push(null);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (values.length === 0) return "";
  if (values.length === 1 && values[0] !== null) return values[0];
  notes.push(`${configPath}: basePath is not a single string literal, so no routes were extracted for this app.`);
  return null;
}

function hasUseServerDirective(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function modifierKinds(node: ts.Node): ts.SyntaxKind[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).map((modifier) => modifier.kind) : [];
}

// URL pattern for a route.ts folder, with Next's own [param] syntax kept as
// written. Returns a reason instead when a segment's URL can't be stated exactly.
function appPattern(folders: string[]): { pattern: string } | { reason: string } {
  const segments: string[] = [];
  for (const folder of folders) {
    if (folder.startsWith("(.")) return { reason: `intercepting segment ${folder}` };
    if (folder.startsWith("(") && folder.endsWith(")")) continue;
    if (folder.startsWith("@")) return { reason: `parallel route slot ${folder}` };
    if (folder.includes("%")) return { reason: `URL-encoded segment ${folder}` };
    segments.push(folder);
  }
  return { pattern: `/${segments.join("/")}` };
}

// Exported HTTP method handlers, by exported name: functions, constants and
// export lists. `export *` can't be enumerated, so it's noted, not guessed.
function exportedMethods(file: AdapterFile, notes: string[]): { method: string; line: number }[] {
  const found: { method: string; line: number }[] = [];
  const lineOf = (node: ts.Node) => file.source.getLineAndCharacterOfPosition(node.getStart(file.source)).line + 1;
  for (const statement of file.source.statements) {
    const kinds = modifierKinds(statement);
    const exported = kinds.includes(ts.SyntaxKind.ExportKeyword) && !kinds.includes(ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(statement) && exported && statement.name && HTTP_METHODS.has(statement.name.text)) {
      found.push({ method: statement.name.text, line: lineOf(statement) });
    } else if (ts.isVariableStatement(statement) && exported) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.has(declaration.name.text)) {
          found.push({ method: declaration.name.text, line: lineOf(declaration) });
        }
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause) {
        notes.push(`${file.path}:${lineOf(statement)}: \`export *\` may export further handlers that are not listed.`);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly && HTTP_METHODS.has(element.name.text)) {
            found.push({ method: element.name.text, line: lineOf(element) });
          }
        }
      }
    }
  }
  return found;
}

export const nextjsAdapter: RepositoryAdapter = {
  name: "nextjs",
  async detect(repository): Promise<AdapterRun | null> {
    const roots = await packageRootsDeclaring(repository, ["next"]);
    if (roots.length === 0) return null;
    const notes: string[] = [];
    const apps = new Map<string, NextApp>();
    for (const root of roots) {
      apps.set(root, {
        root,
        appDir: routerDir(repository, root, "app"),
        pagesDir: routerDir(repository, root, "pages"),
        basePath: await readBasePath(repository, root, notes),
      });
    }
    const routes: Route[] = [];
    let pagesApiRoutes = 0;

    function appRole(file: AdapterFile, app: NextApp, inner: string): string | null {
      const segments = inner.split("/");
      const folders = segments.slice(0, -1);
      // Folders starting with an underscore are private: never routed.
      if (folders.some((folder) => folder.startsWith("_"))) return null;
      const name = segments[segments.length - 1];
      const role = APP_FILES[name.slice(0, name.lastIndexOf("."))];
      if (!role) return null;
      if (role === NEXTJS_ROLES.apiRoute && app.basePath !== null) {
        const pattern = appPattern(folders);
        if ("reason" in pattern) {
          notes.push(`${file.path}: ${pattern.reason}, so its URL can't be stated exactly and no route was extracted.`);
        } else {
          const full = app.basePath === "" ? pattern.pattern : pattern.pattern === "/" ? app.basePath : `${app.basePath}${pattern.pattern}`;
          for (const { method, line } of exportedMethods(file, notes)) {
            routes.push({ file: file.path, method, path: full, line });
          }
        }
      }
      return role;
    }

    function pagesRole(inner: string): string {
      const name = inner.slice(inner.lastIndexOf("/") + 1);
      const stem = name.slice(0, name.lastIndexOf("."));
      if (inner.startsWith("api/")) {
        pagesApiRoutes += 1;
        return NEXTJS_ROLES.apiRoute;
      }
      if (inner === name && (stem === "_app" || stem === "_document")) return NEXTJS_ROLES.layout;
      if (inner === name && (stem === "_error" || stem === "404" || stem === "500")) return NEXTJS_ROLES.routeUi;
      return NEXTJS_ROLES.page;
    }

    return {
      name: "nextjs",
      roleOf(file) {
        const root = packageRootOf(file.path, roots);
        const app = root === null ? undefined : apps.get(root);
        if (!app || root === null) return reactRole(file.path);
        const relative = withinRoot(file.path, root);
        const generic = genericRole(file.path);
        if (ROUTABLE.test(relative) && generic !== GENERIC_ROLES.test && generic !== GENERIC_ROLES.typeDeclaration) {
          if (app.appDir && relative.startsWith(`${app.appDir}/`)) {
            const role = appRole(file, app, relative.slice(app.appDir.length + 1));
            if (role) return role;
          } else if (app.pagesDir && relative.startsWith(`${app.pagesDir}/`)) {
            return pagesRole(relative.slice(app.pagesDir.length + 1));
          }
          if (ROOT_MIDDLEWARE.test(relative)) return NEXTJS_ROLES.middleware;
          if (ROOT_INSTRUMENTATION.test(relative)) return GENERIC_ROLES.config;
        }
        if (hasUseServerDirective(file.source)) return NEXTJS_ROLES.serverAction;
        return reactRole(file.path);
      },
      finish() {
        if (pagesApiRoutes > 0) {
          notes.push(`${pagesApiRoutes} pages/api handler(s) choose their method at runtime, so no routes were extracted for them.`);
        }
        routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.file.localeCompare(right.file));
        return { routes, notes };
      },
    };
  },
};
