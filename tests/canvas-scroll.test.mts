import assert from "node:assert/strict";
import test from "node:test";
import type { Folding } from "../lib/canvas/fold.ts";
import { highlightFor } from "../lib/canvas/selection.ts";
import { ABOVE_HANDLE, MORE_HANDLE, SIZES, buildCanvasView } from "../lib/canvas/view.ts";
import type { Edge, FileNode } from "../lib/parser/types.mts";

const files: FileNode[] = [
  ...Array.from({ length: 15 }, (_, index) => ({
    path: `a/${index}.ts`, folder: "a", moduleId: `a/${index}`, kind: "module",
    lineCount: 1, sha256: "", fanIn: 15 - index, fanOut: 1,
  })),
  { path: "b/target.ts", folder: "b", moduleId: "b/target", kind: "module", lineCount: 1, sha256: "", fanIn: 2, fanOut: 0 },
];
const edges: Edge[] = [
  { from: "a/0.ts", to: "b/target.ts", kind: "import" },
  { from: "a/14.ts", to: "b/target.ts", kind: "import" },
];
const folding: Folding = {
  threshold: 2,
  groups: [{ folder: "a", files: files.slice(0, 15).map((file) => file.path) }, { folder: "b", files: ["b/target.ts"] }],
  groupOf: new Map(files.map((file) => [file.path, file.folder])),
};

test("an open panel keeps all rows scrollable and reconnects edges at the visible window", () => {
  const open = new Set(["a"]);
  const initial = buildCanvasView(files, edges, folding, open);
  const initialPanel = initial.nodes.find((node) => node.folder === "a");
  assert.ok(initialPanel?.kind === "panel");
  assert.equal(initialPanel.rows.length, 15);
  assert.equal(initialPanel.height, SIZES.panelHeader + SIZES.row * (SIZES.maxRows + 1));
  assert.equal(initialPanel.aboveRows, 0);
  assert.equal(initialPanel.belowRows, 3);
  assert.deepEqual(initial.edges.map((edge) => edge.sourceHandle).sort(), [`out:${MORE_HANDLE}`, "out:a/0.ts"].sort());

  const scrolled = buildCanvasView(files, edges, folding, open, new Map([["a", 3 * SIZES.row]]));
  const scrolledPanel = scrolled.nodes.find((node) => node.folder === "a");
  assert.ok(scrolledPanel?.kind === "panel");
  assert.equal(scrolledPanel.height, initialPanel.height);
  assert.equal(scrolledPanel.aboveRows, 3);
  assert.equal(scrolledPanel.belowRows, 0);
  assert.deepEqual(scrolled.edges.map((edge) => edge.sourceHandle).sort(), [`out:${ABOVE_HANDLE}`, "out:a/14.ts"].sort());
  const selected = highlightFor(scrolled, { kind: "row", node: "panel:a", path: "a/14.ts" });
  assert.equal(selected?.edges.size, 1);
  assert.ok(selected?.nodes.has("folder:b"));
});
