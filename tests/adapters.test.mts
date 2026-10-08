import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FRAMEWORK_ADAPTERS } from "../lib/parser/adapters/index.mts";
import { parseRepository } from "../lib/parser/parse.mts";
import type { ParserResult } from "../lib/parser/types.mts";

async function parseFixture(files: Record<string, string>): Promise<ParserResult> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deslop-adapters-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }
    return await parseRepository(root, FRAMEWORK_ADAPTERS);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const roleOf = (result: ParserResult, file: string) => result.files.find((item) => item.path === file)?.kind;
const routeLines = (result: ParserResult) => result.routes.map((route) => `${route.method} ${route.path} ${route.file}`);

test("Next.js: roles from paths, handler routes exact, unknowable URLs withheld", async () => {
  const result = await parseFixture({
    "package.json": JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }),
    "next.config.ts": "export default { basePath: '/docs' };\n",
    "app/layout.tsx": "export default function Layout() { return null; }\n",
    "app/(marketing)/about/page.tsx": "export default function Page() { return null; }\n",
    "app/api/items/[id]/route.ts": [
      "export async function GET() { return new Response(); }",
      "export const POST = async () => new Response();",
      "const remove = async () => new Response();",
      "export { remove as DELETE };",
      "export function helper() {}",
    ].join("\n"),
    "app/api/(v1)/health/route.ts": "export function HEAD() { return new Response(); }\n",
    "app/feed/(..)photo/route.ts": "export function GET() { return new Response(); }\n",
    "app/_lib/page.tsx": "export default function NotRouted() { return null; }\n",
    "app/actions.ts": "'use server';\nexport async function save() {}\n",
    "pages/api/legacy.ts": "export default function handler() {}\n",
    "components/Button.tsx": "export function Button() { return null; }\n",
    "hooks/useThing.ts": "export function useThing() {}\n",
    "proxy.ts": "export function proxy() {}\n",
    "app/page.test.tsx": "export {};\n",
  });
  assert.equal(result.adapter, "nextjs");
  assert.equal(roleOf(result, "app/layout.tsx"), "layout");
  assert.equal(roleOf(result, "app/(marketing)/about/page.tsx"), "page");
  assert.equal(roleOf(result, "app/api/items/[id]/route.ts"), "api-route");
  assert.equal(roleOf(result, "app/_lib/page.tsx"), "other");
  assert.equal(roleOf(result, "app/actions.ts"), "server-action");
  assert.equal(roleOf(result, "pages/api/legacy.ts"), "api-route");
  assert.equal(roleOf(result, "components/Button.tsx"), "component");
  assert.equal(roleOf(result, "hooks/useThing.ts"), "hook");
  assert.equal(roleOf(result, "proxy.ts"), "middleware");
  assert.equal(roleOf(result, "next.config.ts"), "config");
  assert.equal(roleOf(result, "app/page.test.tsx"), "test");
  assert.deepEqual(routeLines(result), [
    "HEAD /docs/api/health app/api/(v1)/health/route.ts",
    "DELETE /docs/api/items/[id] app/api/items/[id]/route.ts",
    "GET /docs/api/items/[id] app/api/items/[id]/route.ts",
    "POST /docs/api/items/[id] app/api/items/[id]/route.ts",
  ]);
  assert.ok(result.coverage.routeNotes.some((note) => note.includes("(..)photo")));
  assert.ok(result.coverage.routeNotes.some((note) => note.includes("pages/api")));
});

test("Next.js: a basePath that isn't a literal withholds every route", async () => {
  const result = await parseFixture({
    "package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }),
    "next.config.js": "module.exports = { basePath: process.env.BASE };\n",
    "app/api/route.ts": "export function GET() { return new Response(); }\n",
  });
  assert.equal(result.routes.length, 0);
  assert.ok(result.coverage.routeNotes.some((note) => note.includes("basePath")));
});

test("NestJS: roles from suffixes, routes from controller and method decorators", async () => {
  const result = await parseFixture({
    "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "11.0.0", "@nestjs/common": "11.0.0" } }),
    "src/main.ts": "async function bootstrap(app: any) { app.setGlobalPrefix('api'); }\nvoid bootstrap;\n",
    "src/users/users.controller.ts": [
      "import { Controller, Get, Post as HttpPost, Delete } from '@nestjs/common';",
      "const SUB = 'x';",
      "@Controller('users/')",
      "export class UsersController {",
      "  @Get() list() {}",
      "  @Get(':id') one() {}",
      "  @HttpPost(['', 'bulk']) create() {}",
      "  @Delete(SUB) remove() {}",
      "}",
    ].join("\n"),
    "src/health.controller.ts": [
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller({ path: 'health' })",
      "export class HealthController { @Get('/live') live() {} }",
    ].join("\n"),
    "src/local.controller.ts": [
      "const Controller = (_: string) => (_target: unknown) => {};",
      "const Get = () => (_t: unknown, _k: string) => {};",
      "@Controller('fake') export class Fake { @Get() x() {} }",
    ].join("\n"),
    "src/users/users.service.ts": "export class UsersService {}\n",
    "src/users/users.module.ts": "export class UsersModule {}\n",
    "src/users/user.entity.ts": "export class User {}\n",
    "src/users/users.controller.spec.ts": "export {};\n",
  });
  assert.equal(result.adapter, "nestjs");
  assert.equal(roleOf(result, "src/users/users.controller.ts"), "controller");
  assert.equal(roleOf(result, "src/users/users.service.ts"), "service");
  assert.equal(roleOf(result, "src/users/users.module.ts"), "module");
  assert.equal(roleOf(result, "src/users/user.entity.ts"), "entity");
  assert.equal(roleOf(result, "src/users/users.controller.spec.ts"), "test");
  assert.equal(roleOf(result, "src/main.ts"), "other");
  assert.deepEqual(routeLines(result), [
    "GET /api/health/live src/health.controller.ts",
    "GET /api/users src/users/users.controller.ts",
    "POST /api/users src/users/users.controller.ts",
    "GET /api/users/:id src/users/users.controller.ts",
    "POST /api/users/bulk src/users/users.controller.ts",
  ]);
  assert.ok(result.coverage.routeNotes.some((note) => note.includes("users.controller.ts:8")));
});

test("NestJS: a non-literal global prefix or versioning withholds the package's routes", async () => {
  for (const main of ["app.setGlobalPrefix(PREFIX);", "app.enableVersioning();"]) {
    const result = await parseFixture({
      "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "11.0.0" } }),
      "src/main.ts": `declare const app: any; declare const PREFIX: string;\n${main}\n`,
      "src/a.controller.ts": "import { Controller, Get } from '@nestjs/common';\n@Controller('a') export class A { @Get() x() {} }\n",
    });
    assert.equal(result.routes.length, 0, main);
    assert.equal(result.coverage.routeNotes.length, 1, main);
  }
});

test("detection order: Next.js wins over React; nothing matched means generic roles and no routes", async () => {
  const next = await parseFixture({
    "package.json": JSON.stringify({ dependencies: { react: "19.0.0", next: "16.0.0" } }),
    "app/page.tsx": "export default function Page() { return null; }\n",
  });
  assert.equal(next.adapter, "nextjs");
  const react = await parseFixture({
    "package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }),
    "src/App.tsx": "export function App() { return null; }\n",
  });
  assert.equal(react.adapter, "react");
  assert.equal(roleOf(react, "src/App.tsx"), "component");
  const plain = await parseFixture({
    "index.js": "export const x = 1;\n",
    "vite.config.js": "export default {};\n",
    "types.d.ts": "export type T = 1;\n",
  });
  assert.equal(plain.adapter, "fallback");
  assert.deepEqual(plain.files.map((file) => file.kind).sort(), ["config", "other", "type-declaration"]);
  assert.equal(plain.routes.length, 0);
});
