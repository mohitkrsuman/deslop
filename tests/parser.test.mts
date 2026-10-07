import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRepository } from "../lib/parser/parse.mts";
import { readParserResult, writeParserResult } from "../lib/parser/result-file.mts";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deslop-parser-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
  return root;
}

test("records imports, re-exports, dynamic imports, coverage, and distinct fan counts", async () => {
  const root = await fixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    "src/main.ts": [
      "import { value } from './barrel';",
      "import './barrel';",
      "import { value as aliasValue } from '@/leaf';",
      "const lazy = import('./lazy');",
      "import './missing';",
      "import 'node:fs';",
      "import './style.css';",
      "const unknown = import(aliasValue);",
      "void value; void lazy; void unknown;",
    ].join("\n"),
    "src/barrel/index.ts": "export { value } from '../leaf';\nexport * from '../lazy';\n",
    "src/leaf.ts": "export const value = 1;\n",
    "src/lazy.ts": "export const lazy = 2;\n",
    "src/style.css": "body {}\n",
  });
  try {
    const result = await parseRepository(root);
    assert.equal(result.coverage.filesFound, result.coverage.filesParsed + result.coverage.filesSkipped);
    assert.equal(result.coverage.filesParsed, 4);
    assert.equal(result.coverage.skippedFiles.length, result.coverage.filesSkipped);
    assert.equal(result.edges.length, 5);
    assert.equal(result.imports.filter((item) => item.kind === "re-export").length, 2);
    assert.equal(result.imports.filter((item) => item.kind === "re-export" && item.status === "resolved").length, 2);
    assert.equal(result.coverage.imports.unresolved, 1);
    assert.equal(result.coverage.imports.external, 1);
    assert.equal(result.coverage.imports.excluded, 2);
    assert.match(result.coverage.imports.unresolvedExamples[0]?.status === "unresolved"
      ? result.coverage.imports.unresolvedExamples[0].reason : "", /relative target/);
    assert.equal(result.files.find((file) => file.path === "src/main.ts")?.fanOut, 3);
    assert.equal(result.files.find((file) => file.path === "src/leaf.ts")?.fanIn, 2);
    assert.equal(result.files.find((file) => file.path === "src/barrel/index.ts")?.folder, "src/barrel");
    assert.equal(result.files.find((file) => file.path === "src/barrel/index.ts")?.moduleId, "src/barrel/index");
    assert.ok(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
    const output = path.join(root, "result.json");
    await writeParserResult(output, result);
    assert.deepEqual(await readParserResult(output), result);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renaming one imported file produces exactly one named unresolved import", async () => {
  const root = await fixture({
    "entry.ts": "import { value } from './leaf';\nvoid value;\n",
    "leaf.ts": "export const value = 1;\n",
  });
  try {
    const before = await parseRepository(root);
    assert.equal(before.coverage.imports.unresolved, 0);
    await rename(path.join(root, "leaf.ts"), path.join(root, "renamed.ts"));
    const after = await parseRepository(root);
    assert.equal(after.coverage.imports.unresolved, 1);
    assert.equal(after.imports.find((item) => item.status === "unresolved")?.specifier, "./leaf");
    assert.match(after.coverage.imports.unresolvedExamples[0]?.status === "unresolved"
      ? after.coverage.imports.unresolvedExamples[0].reason : "", /relative target/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid source is skipped and invalid tsconfig is reported without stopping the scan", async () => {
  const root = await fixture({
    "tsconfig.json": "{ invalid json",
    "entry.ts": "import './leaf';\n",
    "leaf.ts": "export const value = 1;\n",
    "broken.ts": "import { from './leaf';\n",
  });
  try {
    const result = await parseRepository(root);
    assert.equal(result.coverage.filesParsed, 2);
    assert.equal(result.coverage.skippedFiles.find((file) => file.path === "broken.ts")?.reason, "parse_error");
    assert.equal(result.coverage.imports.resolved, 1);
    assert.equal(result.coverage.configurationWarnings.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
