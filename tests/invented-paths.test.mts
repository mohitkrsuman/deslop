import assert from "node:assert/strict";
import test from "node:test";
import { findInventedPaths, pathsInSource } from "../lib/ai/invented-paths.ts";

const shown = ["lib/db.ts", "app/(workspace)/page.tsx", "components/canvas/path-list.tsx"];

test("paths the model was shown pass, including short references to them", () => {
  const text = "Reads `lib/db.ts` and is imported by app/(workspace)/page.tsx. The `path-list.tsx` list (canvas/path-list.tsx) renders it.";
  assert.deepEqual(findInventedPaths(text, shown), {
    checked: ["lib/db.ts", "app/(workspace)/page.tsx", "path-list.tsx", "canvas/path-list.tsx"],
    fromSource: [],
    invented: [],
  });
});

test("a made-up filename spliced in is caught", () => {
  const text = "Reads `lib/db.ts`, then hands off to `lib/session-store.ts` (see utils/format.ts).";
  assert.deepEqual(findInventedPaths(text, shown).invented, ["lib/session-store.ts", "utils/format.ts"]);
});

test("words that are not paths are not flagged", () => {
  const text = "A Next.js route built on Node.js, using `react-dom/client`, `next/navigation`, `.tsx` files and https://example.com/a.js.";
  assert.deepEqual(findInventedPaths(text, shown), { checked: [], fromSource: [], invented: [] });
});

test("a path written in the shown source counts as shown, listed apart", () => {
  const source = `import "./Tooltip.scss";\nconst out = path.join(__dirname, "../docs/star-history.json");`;
  const sourcePaths = pathsInSource(source);
  assert.deepEqual(sourcePaths, ["Tooltip.scss", "docs/star-history.json"]);
  const text = "Styles come from `Tooltip.scss`; it writes `docs/star-history.json` and reads `lib/db.ts`, not `lib/cache.ts`.";
  assert.deepEqual(findInventedPaths(text, shown, sourcePaths), {
    checked: ["Tooltip.scss", "docs/star-history.json", "lib/db.ts", "lib/cache.ts"],
    fromSource: ["Tooltip.scss", "docs/star-history.json"],
    invented: ["lib/cache.ts"],
  });
});

test("a bare filename in code is checked", () => {
  assert.deepEqual(findInventedPaths("Calls `helpers.ts`.", shown).invented, ["helpers.ts"]);
});
