import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fetchGithubArchive, parseGithubUrl } from "../lib/github-archive.ts";

function tarFile(name: string, contents: string | Buffer): Buffer {
  const body = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8);
  header.write("0000000\0", 108, 8);
  header.write("0000000\0", 116, 8);
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  header.write("00000000000\0", 136, 12);
  header.fill(32, 148, 156);
  header.write("0", 156, 1);
  header.write("ustar\0", 257, 6);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

test("canonical GitHub URLs and commit-pinned archive extraction", async () => {
  const repo = parseGithubUrl("https://github.com/Owner/Repo.git/");
  assert.equal(repo.url, "https://github.com/owner/repo");
  assert.throws(() => parseGithubUrl("https://github.com/owner/repo/tree/main"));
  assert.throws(() => parseGithubUrl("http://github.com/owner/repo"));

  const sha = "a".repeat(40);
  const archive = gzipSync(Buffer.concat([
    tarFile("repo-commit/src/index.ts", "export const ready = true;\n"), Buffer.alloc(1024),
  ]));
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return calls.length === 1 ? Response.json({ sha }) : new Response(archive);
  };
  try {
    const result = await fetchGithubArchive(repo);
    try {
      assert.equal(result.commitSha, sha);
      assert.equal(await readFile(`${result.directory}/src/index.ts`, "utf8"), "export const ready = true;\n");
      assert.equal(calls[1], `https://codeload.github.com/owner/repo/tar.gz/${sha}`);
    } finally { await rm(result.directory, { recursive: true, force: true }); }
  } finally { globalThis.fetch = originalFetch; }
});

test("archives above 30 MB extract and the 1 GB download limit is enforced", async () => {
  const repo = parseGithubUrl("https://github.com/owner/repo");
  const sha = "b".repeat(40);
  const archive = gzipSync(Buffer.concat([
    tarFile("repo-commit/src/data.bin", randomBytes(31 * 1024 * 1024)),
    Buffer.alloc(1024),
  ]));
  assert.ok(archive.length > 30 * 1024 * 1024);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/commits/HEAD")
    ? Response.json({ sha })
    : new Response(archive, { headers: { "content-length": String(archive.length) } });
  try {
    const result = await fetchGithubArchive(repo);
    try {
      assert.equal((await stat(`${result.directory}/src/data.bin`)).size, 31 * 1024 * 1024);
    } finally { await rm(result.directory, { recursive: true, force: true }); }

    globalThis.fetch = async (input) => String(input).includes("/commits/HEAD")
      ? Response.json({ sha })
      : new Response("too large", { headers: { "content-length": String(1024 ** 3 + 1) } });
    await assert.rejects(fetchGithubArchive(repo), /1 GB download limit/);
  } finally { globalThis.fetch = originalFetch; }
});
