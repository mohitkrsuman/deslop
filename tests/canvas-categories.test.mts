import assert from "node:assert/strict";
import test from "node:test";
import { categoriesOf, categoryFilterFor } from "../lib/canvas/categories.ts";
import { foldDirectories } from "../lib/canvas/fold.ts";
import { buildCanvasView, SIZES } from "../lib/canvas/view.ts";
import type { Edge, FileNode } from "../lib/parser/types.mts";

test("category counts include hidden rows and folded groups without removing files or edges", () => {
  const files: FileNode[] = Array.from({ length: 30 }, (_, i) => {
    const folder = i < 20 ? "a" : "b";
    const path = `${folder}/${i}.${i % 3 === 0 ? "tsx" : "ts"}`;
    return { path, folder, kind: "module", moduleId: path, lineCount: 1, sha256: "", fanIn: 0, fanOut: 0 };
  });
  const edges: Edge[] = [
    { from: files[0].path, to: files[20].path, kind: "import" },
    { from: files[1].path, to: files[22].path, kind: "import" },
  ];
  const folding = foldDirectories(files);
  const filter = categoryFilterFor(files, folding, ".tsx")!;
  assert.equal(filter.paths.size, 10);
  assert.equal(filter.counts.get("a"), 7);
  assert.equal(filter.counts.get("b"), 3);
  const view = buildCanvasView(files, edges, folding, new Set(["a"]));
  const panel = view.nodes.find((node) => node.folder === "a");
  assert.ok(panel?.kind === "panel");
  assert.equal(panel.rows.length, 20);
  assert.ok(panel.rows.length > SIZES.maxRows);
  assert.equal(panel.rows.filter((row) => filter.paths.has(row.path)).length, filter.counts.get("a"));
  assert.equal(view.nodes.length, folding.groups.length);
  assert.equal(view.edges.length, 2);
  assert.equal(view.edges.filter((edge) => edge.extensions.includes(".tsx")).length, 1);
  assert.equal(categoryFilterFor(files, folding, null), null);
});

test("category counts reconcile across every folded and open panel", () => {
  const files: FileNode[] = Array.from({ length: 65 }, (_, index) => {
    const folder = `packages/${Math.floor(index / 13)}`;
    const path = `${folder}/module-${index}.${index % 4 === 0 ? "tsx" : "ts"}`;
    return { path, folder, kind: "module", moduleId: path, lineCount: 1, sha256: "", fanIn: 0, fanOut: 0 };
  });
  const folding = foldDirectories(files);
  const view = buildCanvasView(files, [], folding, new Set(folding.groups.map((group) => group.folder)));
  for (const category of categoriesOf(files)) {
    const filter = categoryFilterFor(files, folding, category.extension)!;
    assert.equal([...filter.counts.values()].reduce((sum, count) => sum + count, 0), category.count);
    for (const panel of view.nodes) {
      assert.ok(panel.kind === "panel");
      assert.equal(panel.rows.filter((row) => filter.paths.has(row.path)).length, filter.counts.get(panel.folder));
    }
  }
});
