import assert from "node:assert/strict";
import test from "node:test";
import { buildDetailIndex } from "../lib/canvas/details.ts";
import type { Edge, FileNode } from "../lib/parser/types.mts";

function file(path: string, kind = "module"): FileNode {
  return { path, folder: path.split("/")[0], moduleId: path.replace(/\.ts$/, ""), kind, lineCount: 1, sha256: "", fanIn: 0, fanOut: 0 };
}

const files = [file("src/entry.ts"), file("src/other.ts"), file("src/shared.ts"), file("src/unused.ts"), file("app/page.ts", "route")];
const edges: Edge[] = [
  { from: "src/entry.ts", to: "src/shared.ts", kind: "import" },
  { from: "src/entry.ts", to: "src/shared.ts", kind: "re-export" },
  { from: "src/other.ts", to: "src/shared.ts", kind: "import" },
  { from: "src/entry.ts", to: "src/other.ts", kind: "import" },
];

test("detail counts match distinct listed neighbours and summary ranks", () => {
  const index = buildDetailIndex(files, edges);
  assert.deepEqual(index.dependencies.get("src/entry.ts"), ["src/other.ts", "src/shared.ts"]);
  assert.deepEqual(index.dependents.get("src/shared.ts"), ["src/entry.ts", "src/other.ts"]);
  assert.equal(index.dependencies.get("src/entry.ts")?.length, 2);
  assert.equal(index.dependents.get("src/shared.ts")?.length, 2);
  assert.equal(index.mostDependedOn[0]?.path, "src/shared.ts");
  assert.deepEqual(index.unimported.map((item) => item.path), ["src/entry.ts", "app/page.ts", "src/unused.ts"]);
  assert.equal(index.routeCount, 1);
  assert.equal(index.unidentifiedCount, 4);
});
