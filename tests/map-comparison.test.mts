import assert from "node:assert/strict";
import test from "node:test";
import { compareMaps } from "../lib/graph/compare.ts";
import type { Edge, FileNode, ParserCoverage } from "../lib/parser/types.mts";

function file(path: string, sha256 = path): FileNode {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  return { path, folder, moduleId: path, kind: "other", lineCount: 1, sha256, fanIn: 0, fanOut: 0 };
}

function edge(from: string, to: string): Edge {
  return { from, to, kind: "import" };
}

function coverage(skippedFiles: ParserCoverage["skippedFiles"] = [], skippedDirectories: ParserCoverage["skippedDirectories"] = []): ParserCoverage {
  return {
    filesFound: 0, filesParsed: 0, filesSkipped: skippedFiles.length, skippedFiles, skippedDirectories,
    configurationWarnings: [], routeNotes: [],
    imports: { found: 0, resolved: 0, external: 0, excluded: 0, unresolved: 0, unresolvedExamples: [] },
  };
}

test("an added file and its import are reported, nothing else", () => {
  const base = { files: [file("src/a.ts"), file("src/b.ts")], edges: [edge("src/a.ts", "src/b.ts")] };
  const after = {
    files: [...base.files, file("src/c.ts")],
    edges: [...base.edges, edge("src/c.ts", "src/a.ts")],
    coverage: coverage(),
  };
  const diff = compareMaps(base, after);
  assert.deepEqual(diff.added.map((item) => item.path), ["src/c.ts"]);
  assert.deepEqual(diff.addedEdges, [edge("src/c.ts", "src/a.ts")]);
  assert.deepEqual([diff.removed, diff.changed, diff.removedEdges, diff.unparsed], [[], [], [], []]);
});

test("a rename is a removal and an addition, never a rename", () => {
  const base = { files: [file("a.ts", "same"), file("b.ts")], edges: [edge("b.ts", "a.ts")] };
  const after = { files: [file("renamed.ts", "same"), file("b.ts")], edges: [edge("b.ts", "renamed.ts")], coverage: coverage() };
  const diff = compareMaps(base, after);
  assert.deepEqual(diff.removed, ["a.ts"]);
  assert.deepEqual(diff.added.map((item) => item.path), ["renamed.ts"]);
  assert.deepEqual(diff.removedEdges, [edge("b.ts", "a.ts")]);
  assert.deepEqual(diff.addedEdges, [edge("b.ts", "renamed.ts")]);
});

test("an edited body is changed, with no import differences", () => {
  const base = { files: [file("a.ts", "one"), file("b.ts")], edges: [edge("a.ts", "b.ts")] };
  const after = { files: [file("a.ts", "two"), file("b.ts")], edges: [edge("a.ts", "b.ts")], coverage: coverage() };
  const diff = compareMaps(base, after);
  assert.deepEqual(diff.changed, ["a.ts"]);
  assert.deepEqual([diff.added, diff.removed, diff.addedEdges, diff.removedEdges], [[], [], [], []]);
});

test("a file the after side couldn't parse is unparsed, not removed, and its imports aren't removed", () => {
  const base = {
    files: [file("a.ts"), file("b.ts"), file("lib/c.ts")],
    edges: [edge("a.ts", "b.ts"), edge("a.ts", "lib/c.ts")],
  };
  const after = {
    files: [file("b.ts")],
    edges: [],
    coverage: coverage(
      [{ path: "a.ts", reason: "parse_error", detail: "Unexpected token" }],
      [{ path: "lib", reason: "read_error", detail: "Could not list directory" }],
    ),
  };
  const diff = compareMaps(base, after);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.unparsed.map((item) => item.path), ["a.ts", "lib/c.ts"]);
  assert.deepEqual(diff.removedEdges, []);
});

test("an import and a re-export between the same files are one connection", () => {
  const base = { files: [file("a.ts"), file("b.ts")], edges: [] };
  const after = {
    files: base.files,
    edges: [edge("a.ts", "b.ts"), { from: "a.ts", to: "b.ts", kind: "re-export" as const }],
    coverage: coverage(),
  };
  assert.equal(compareMaps(base, after).addedEdges.length, 1);
});
