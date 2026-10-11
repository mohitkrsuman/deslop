import assert from "node:assert/strict";
import test from "node:test";
import { parseExplanation, type Block, type Inline, type PathKind } from "../lib/canvas/markup.ts";

const files = new Set(["lib/db.ts", "app/(workspace)/page.tsx", "proxy.ts"]);
const folders = new Set(["lib", "app/(workspace)"]);
const resolve = (candidate: string): PathKind | null =>
  files.has(candidate) ? "file" : folders.has(candidate) ? "folder" : null;

function flat(inlines: Inline[]): string {
  return inlines.map((item) => item.kind === "bold" ? flat(item.children) : item.kind === "path" ? `[${item.path}]` : item.text).join("");
}

function render(blocks: Block[]): string {
  return blocks.map((block) => block.kind === "paragraph" ? flat(block.inlines) : block.items.map((item) => `• ${flat(item)}`).join("\n")).join("\n\n");
}

test("renders the three permitted formats and links paths", () => {
  const blocks = parseExplanation("It wraps `lib/db.ts` and **owns** the `query()` call.\n\n- used by app/(workspace)/page.tsx.\n- and (proxy.ts)", resolve);
  assert.equal(render(blocks), "It wraps [lib/db.ts] and owns the query() call.\n\n• used by [app/(workspace)/page.tsx].\n• and ([proxy.ts])");
  const first = blocks[0];
  assert.equal(first.kind, "paragraph");
  assert.deepEqual(first.kind === "paragraph" && first.inlines.map((item) => item.kind), ["text", "path", "text", "bold", "text", "code", "text"]);
});

test("drops markers it does not permit, leaving no stray syntax", () => {
  const output = render(parseExplanation("## Overview\nSome *emphasis* and a stray ` tick and ** marker.\n1. first\n---\n### End", resolve));
  assert.equal(output, "Overview\n\nSome emphasis and a stray  tick and  marker.\n\n• first\n\nEnd");
  assert.doesNotMatch(output, /[`*#]/);
});

test("links bare folder names only inside code", () => {
  const output = render(parseExplanation("The lib folder, also `lib` and lib/db.ts:", resolve));
  assert.equal(output, "The lib folder, also [lib] and [lib/db.ts]:");
});

test("leaves unknown paths as text", () => {
  assert.equal(render(parseExplanation("See `src/missing.ts` and src/missing.ts.", resolve)), "See src/missing.ts and src/missing.ts.");
});
