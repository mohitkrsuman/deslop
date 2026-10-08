import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGraphIndex, findImportCycles, walkGraph } from "../lib/graph/graph.ts";
import { buildInsights, INSIGHT_SENTENCES } from "../lib/graph/insights.ts";
import { isConventionEntryPoint } from "../lib/parser/adapters/entry-points.mts";
import type { Edge, FileNode, ParserResult } from "../lib/parser/types.mts";

function file(path: string, kind = "module", lineCount = 1): FileNode {
  return { path, kind, lineCount, folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".", moduleId: path, sha256: "", fanIn: 999, fanOut: 999 };
}
const edge = (from: string, to: string, kind: Edge["kind"] = "import"): Edge => ({ from, to, kind });

test("one walk handles both directions, shortest distances, cycles, duplicates and the depth limit", () => {
  const graph = buildGraphIndex(["a", "b", "c", "d", "e", "isolated"].map((path) => file(path)), [
    edge("a", "b"), edge("a", "b", "re-export"), edge("a", "c"), edge("b", "c"),
    edge("c", "d"), edge("d", "e"), edge("d", "a"), edge("a", "a"), edge("missing", "a"),
  ]);
  assert.deepEqual(walkGraph(graph, "a", "dependencies"), [
    { path: "b", depth: 1, via: "a" }, { path: "c", depth: 1, via: "a" }, { path: "d", depth: 2, via: "c" },
  ]);
  assert.deepEqual(walkGraph(graph, "d", "dependents"), [
    { path: "c", depth: 1, via: "d" }, { path: "a", depth: 2, via: "c" }, { path: "b", depth: 2, via: "c" },
  ]);
  assert.deepEqual(walkGraph(graph, "a", "dependencies", 1).map((item) => item.path), ["b", "c"]);
  assert.deepEqual(walkGraph(graph, "a", "dependencies", 3).map((item) => item.path), ["b", "c", "d", "e"]);
  assert.deepEqual(walkGraph(graph, "a", "dependencies", 0), []);
  assert.deepEqual(walkGraph(graph, "isolated", "dependents"), []);
  assert.deepEqual(walkGraph(graph, "unknown", "dependents"), []);
  assert.throws(() => walkGraph(graph, "a", "dependencies", -1), RangeError);
});

test("cycles have a real closed witness, include self imports, and do not confuse a diamond with a cycle", () => {
  const graph = buildGraphIndex(["a", "b", "c", "d", "self", "p", "q", "r", "s"].map((path) => file(path)), [
    edge("a", "c"), edge("c", "b"), edge("b", "a"), edge("b", "d"), edge("d", "b"), edge("self", "self"),
    edge("p", "q"), edge("p", "r"), edge("q", "s"), edge("r", "s"),
  ]);
  const cycles = findImportCycles(graph);
  assert.deepEqual(cycles.map((cycle) => cycle.files), [["a", "b", "c", "d"], ["self"]]);
  for (const cycle of cycles) {
    assert.equal(cycle.path[0], cycle.path.at(-1));
    for (let i = 1; i < cycle.path.length; i += 1) assert.ok(graph.dependencies.get(cycle.path[i - 1])?.includes(cycle.path[i]));
  }
});

test("cycle detection handles a graph deeper than a JavaScript call stack", () => {
  const count = 30_000;
  const files = Array.from({ length: count }, (_, i) => file(String(i).padStart(5, "0")));
  const edges = files.slice(1).map((item, i) => edge(files[i].path, item.path));
  assert.equal(findImportCycles(buildGraphIndex(files, edges)).length, 0);
  edges.push(edge(files[count - 1].path, files[0].path));
  const cycles = findImportCycles(buildGraphIndex(files, edges));
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].files.length, count);
  assert.equal(cycles[0].path.length, count + 1);
});

test("unimported insights exclude entry kinds and framework/config conventions in fallback snapshots", () => {
  const entries = [
    "app/page.tsx", "app/api/users/route.ts", "src/app/(public)/layout.tsx", "src/app/not-found.tsx",
    "apps/web/src/app/team/[id]/page.tsx", "pages/index.tsx", "src/pages/api/items.ts",
    "middleware.ts", "src/proxy.ts", "src/instrumentation.ts", "next.config.ts", "vite.config.mts",
    "eslint.config.mjs", "tsconfig.app.json", ".lintstagedrc.js", "src/routes/+page.server.ts",
  ].map((path) => file(path));
  const classified = ["page", "route", "api-route", "layout", "middleware", "config"].map((kind) => file(`custom/${kind}.ts`, kind));
  const ordinary = [file("src/unused.ts"), file("components/page.tsx"), file("lib/route.ts"), file("lib/configuration.ts"), file("lib/middleware.ts")];
  const files = [...entries, ...classified, ...ordinary];
  for (const entry of [...entries, ...classified]) assert.ok(isConventionEntryPoint(entry), entry.path);
  const insights = buildInsights(files, buildGraphIndex(files, []));
  assert.deepEqual(new Set(insights.unimported.map((item) => item.path)), new Set(ordinary.map((item) => item.path)));
});

test("insights use distinct graph importers, explicit thresholds, and four fixed descriptions", () => {
  const files = [file("hub.ts"), ...Array.from({ length: 20 }, (_, i) => file(`caller-${i}.ts`)), file("long.ts", "module", 501), file("boundary.ts", "module", 500)];
  const edges = files.slice(1, 21).flatMap((item) => [edge(item.path, "hub.ts"), edge(item.path, "hub.ts", "re-export")]);
  const insights = buildInsights(files, buildGraphIndex(files, edges));
  assert.deepEqual(insights.highFanIn.map((item) => item.path), ["hub.ts"]);
  assert.equal(insights.fanInThreshold, 10);
  assert.deepEqual(insights.oversized.map((item) => item.path), ["long.ts"]);
  assert.equal(Object.keys(INSIGHT_SENTENCES).length, 4);
  assert.equal(buildInsights([], buildGraphIndex([], [])).unimported.length, 0);
});

test("the checked-in Excalidraw snapshot has verifiable cycles and two-hop paths", async () => {
  const snapshot: ParserResult = JSON.parse(await readFile(new URL("../data/preview/excalidraw.json", import.meta.url), "utf8"));
  const graph = buildGraphIndex(snapshot.files, snapshot.edges);
  const insights = buildInsights(snapshot.files, graph);
  assert.ok(insights.cycles.length > 0);
  for (const cycle of insights.cycles) {
    assert.ok(cycle.path.length >= 2);
    assert.equal(cycle.path[0], cycle.path.at(-1));
    for (let i = 1; i < cycle.path.length; i += 1) assert.ok(snapshot.edges.some((item) => item.from === cycle.path[i - 1] && item.to === cycle.path[i]));
  }
  const target = snapshot.files.find((item) => walkGraph(graph, item.path, "dependents").some((result) => result.depth === 2));
  assert.ok(target);
  for (const result of walkGraph(graph, target.path, "dependents")) {
    assert.ok(graph.dependencies.get(result.path)?.includes(result.via));
    if (result.depth === 2) assert.ok(graph.dependencies.get(result.via)?.includes(target.path));
  }
  assert.ok(insights.unimported.length > 0);
  assert.ok(insights.unimported.every((item) => graph.dependents.get(item.path)?.length === 0 && !isConventionEntryPoint(item)));
  const page = snapshot.files.find((item) => item.path === "examples/with-nextjs/src/app/page.tsx");
  assert.ok(page);
  assert.equal(graph.dependents.get(page.path)?.length, 0);
  assert.ok(!insights.unimported.some((item) => item.path === page.path));
});
