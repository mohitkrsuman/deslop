import assert from "node:assert/strict";
import test from "node:test";
import { highlightFor, rowKey } from "../lib/canvas/selection.ts";
import type { CanvasView, EdgeView, FolderView } from "../lib/canvas/view.ts";

function folder(id: string): FolderView {
  return { kind: "folder", id, folder: id, label: id, fileCount: 1, fanIn: 0, fanOut: 0, width: 100, height: 40 };
}

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): EdgeView {
  return { id, source, sourceHandle: `out:${sourceHandle}`, target, targetHandle: `in:${targetHandle}`, imports: 1, extensions: [] };
}

const view: CanvasView = {
  nodes: [
    folder("folder:a"),
    {
      kind: "panel", id: "panel:p", folder: "p", label: "p", fileCount: 2, fanIn: 0, fanOut: 0,
      width: 100, height: 80, aboveRows: 0, belowRows: 0, scrollable: false,
      rows: [
        { path: "p/first.ts", label: "first", kind: "module", fanIn: 0, fanOut: 0 },
        { path: "p/second.ts", label: "second", kind: "module", fanIn: 0, fanOut: 0 },
      ],
    },
    folder("folder:b"),
    folder("folder:c"),
  ],
  edges: [
    edge("a-first", "folder:a", "node", "panel:p", "p/first.ts"),
    edge("first-b", "panel:p", "p/first.ts", "folder:b", "node"),
    edge("second-c", "panel:p", "p/second.ts", "folder:c", "node"),
    edge("b-c", "folder:b", "node", "folder:c", "node"),
  ],
};

test("a folded node keeps only direct edges and their endpoints bright", () => {
  const lit = highlightFor(view, { kind: "node", id: "folder:a" });
  assert.ok(lit);
  assert.deepEqual([...lit.nodes], ["folder:a"]);
  assert.deepEqual([...lit.rows], [rowKey("panel:p", "p/first.ts")]);
  assert.deepEqual([...lit.edges], ["a-first"]);
  assert.deepEqual([...lit.outgoing], ["a-first"]);
});

test("a file row keeps its direct neighbors bright without lighting sibling rows or second-hop edges", () => {
  const lit = highlightFor(view, { kind: "row", node: "panel:p", path: "p/first.ts" });
  assert.ok(lit);
  assert.deepEqual([...lit.rows], [rowKey("panel:p", "p/first.ts")]);
  assert.deepEqual([...lit.nodes], ["folder:a", "folder:b"]);
  assert.deepEqual([...lit.edges], ["a-first", "first-b"]);
  assert.deepEqual([...lit.outgoing], ["first-b"]);
});

test("clearing selection restores the undimmed view", () => {
  assert.equal(highlightFor(view, null), null);
});
