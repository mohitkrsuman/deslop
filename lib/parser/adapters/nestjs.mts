import ts from "typescript";
import { GENERIC_ROLES, NESTJS_ROLES } from "../../taxonomy.mts";
import type { AdapterFile, AdapterRun, RepositoryAdapter, Route } from "../types.mts";
import { genericRole } from "./generic.mts";
import { packageRootOf, packageRootsDeclaring } from "./package-roots.mts";

const SUFFIX_ROLES = new Set<string>(Object.values(NESTJS_ROLES));
const METHOD_DECORATORS: Record<string, string> = {
  Get: "GET", Post: "POST", Put: "PUT", Delete: "DELETE", Patch: "PATCH",
  Options: "OPTIONS", Head: "HEAD", Search: "SEARCH", All: "ALL",
};

// A controller method's route before the global prefix is known.
interface Candidate {
  file: string;
  line: number;
  method: string;
  controllerPath: string;
  methodPath: string;
}

// Everything in one package that can change a route's full path.
interface PackageFacts {
  candidates: Candidate[];
  prefixes: { value: string | null; at: string }[];
  // Places that make the full path depend on more than the decorators.
  blockers: string[];
}

// users.controller.ts -> "controller". The suffix is the NestJS convention.
function suffixRole(path: string): string | null {
  const parts = path.slice(path.lastIndexOf("/") + 1).split(".");
  if (parts.length < 3) return null;
  const suffix = parts[parts.length - 2];
  return SUFFIX_ROLES.has(suffix) ? suffix : null;
}

// Local names bound to @nestjs/common exports, mapped to the exported name, so
// `import { Get as HttpGet }` still counts and a local `Get` doesn't.
function commonImports(source: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "@nestjs/common") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      names.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return names;
}

// Paths written as a string literal or an array of them; null for anything else.
function literalPaths(node: ts.Expression | undefined): string[] | null {
  if (!node) return [""];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node) && node.elements.length > 0 && node.elements.every(ts.isStringLiteralLike)) {
    return node.elements.map((element) => (element as ts.StringLiteralLike).text);
  }
  return null;
}

// The controller's path argument. An options object counts only when its path
// is literal and it sets neither a host nor a version, both of which change
// what URL actually reaches the handler.
function controllerPaths(argument: ts.Expression | undefined): string[] | string {
  if (argument && ts.isObjectLiteralExpression(argument)) {
    let paths: string[] | null = [""];
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        return "controller options are not a plain object literal";
      }
      const key = property.name.text;
      if (key === "host" || key === "version") return `controller sets ${key}`;
      if (key === "path") paths = literalPaths(property.initializer);
    }
    return paths ?? "controller path is not a string literal";
  }
  return literalPaths(argument) ?? "controller path is not a string literal";
}

// Nest joins prefix, controller and method paths with single slashes and
// drops trailing ones.
function joinPath(parts: string[]): string {
  const trimmed = parts.map((part) => part.replace(/^\/+|\/+$/g, "")).filter(Boolean);
  return `/${trimmed.join("/")}`;
}

export const nestjsAdapter: RepositoryAdapter = {
  name: "nestjs",
  async detect(repository): Promise<AdapterRun | null> {
    const roots = await packageRootsDeclaring(repository, ["@nestjs/core", "@nestjs/common"]);
    if (roots.length === 0) return null;
    const facts = new Map<string, PackageFacts>(roots.map((root) => [root, { candidates: [], prefixes: [], blockers: [] }]));
    const notes: string[] = [];

    function inspect(file: AdapterFile, packageFacts: PackageFacts): void {
      const decorators = commonImports(file.source);
      const at = (node: ts.Node) => `${file.path}:${file.source.getLineAndCharacterOfPosition(node.getStart(file.source)).line + 1}`;
      const decoratorCall = (decorator: ts.Decorator): { name: string; call: ts.CallExpression } | null => {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return null;
        const name = decorators.get(call.expression.text);
        return name ? { name, call } : null;
      };

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (method === "setGlobalPrefix") {
            const [first, ...rest] = node.arguments;
            packageFacts.prefixes.push({
              value: first && ts.isStringLiteralLike(first) && rest.length === 0 ? first.text : null,
              at: at(node),
            });
          } else if (method === "enableVersioning") {
            packageFacts.blockers.push(`${at(node)}: versioning is enabled`);
          }
        } else if (ts.isIdentifier(node) && node.text === "RouterModule" && !ts.isImportSpecifier(node.parent)) {
          packageFacts.blockers.push(`${at(node)}: RouterModule adds module path prefixes`);
        } else if (ts.isClassDeclaration(node)) {
          const classDecorators = (ts.getDecorators(node) ?? []).map(decoratorCall).filter((item) => item !== null);
          const controller = classDecorators.find((item) => item.name === "Controller");
          if (controller) {
            const paths = controllerPaths(controller.call.arguments[0]);
            if (typeof paths === "string") {
              notes.push(`${at(controller.call)}: ${paths}, so no routes were extracted for this controller.`);
            } else if (classDecorators.some((item) => item.name === "Version")) {
              notes.push(`${at(controller.call)}: controller has @Version, so no routes were extracted for it.`);
            } else {
              for (const member of node.members) {
                if (!ts.isMethodDeclaration(member)) continue;
                const memberDecorators = (ts.getDecorators(member) ?? []).map(decoratorCall).filter((item) => item !== null);
                const versioned = memberDecorators.some((item) => item.name === "Version");
                for (const decorator of memberDecorators) {
                  const method = METHOD_DECORATORS[decorator.name];
                  if (!method) continue;
                  const methodPaths = literalPaths(decorator.call.arguments[0]);
                  if (versioned || !methodPaths) {
                    notes.push(`${at(decorator.call)}: ${versioned ? "handler has @Version" : "route path is not a string literal"}, so no route was extracted.`);
                    continue;
                  }
                  const line = file.source.getLineAndCharacterOfPosition(decorator.call.getStart(file.source)).line + 1;
                  for (const controllerPath of paths) {
                    for (const methodPath of methodPaths) {
                      packageFacts.candidates.push({ file: file.path, line, method, controllerPath, methodPath });
                    }
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file.source);
    }

    return {
      name: "nestjs",
      roleOf(file) {
        const root = packageRootOf(file.path, roots);
        const packageFacts = root === null ? undefined : facts.get(root);
        if (packageFacts) inspect(file, packageFacts);
        const generic = genericRole(file.path);
        if (generic === GENERIC_ROLES.test || generic === GENERIC_ROLES.typeDeclaration || !packageFacts) return generic;
        return suffixRole(file.path) ?? generic;
      },
      finish() {
        const routes: Route[] = [];
        for (const [root, packageFacts] of facts) {
          const where = root === "" ? "the repository root" : root;
          const distinct = new Set(packageFacts.prefixes.map((prefix) => prefix.value));
          const blockers = [...packageFacts.blockers];
          if (distinct.has(null)) {
            blockers.push(...packageFacts.prefixes.filter((prefix) => prefix.value === null)
              .map((prefix) => `${prefix.at}: global prefix is not a single string literal`));
          } else if (distinct.size > 1) {
            blockers.push(`${packageFacts.prefixes.map((prefix) => prefix.at).join(", ")}: different global prefixes`);
          }
          if (packageFacts.candidates.length === 0) continue;
          if (blockers.length > 0) {
            notes.push(`No routes were extracted for ${where}: ${blockers.join("; ")}.`);
            continue;
          }
          const prefix = packageFacts.prefixes[0]?.value ?? "";
          for (const candidate of packageFacts.candidates) {
            routes.push({
              file: candidate.file,
              method: candidate.method,
              path: joinPath([prefix, candidate.controllerPath, candidate.methodPath]),
              line: candidate.line,
            });
          }
        }
        routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.file.localeCompare(right.file));
        return { routes, notes };
      },
    };
  },
};
