import assert from "node:assert/strict";
import { lstat, readFile, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fetchGithubArchive, parseGithubUrl } from "../lib/github-archive.ts";

function tarFile(name: string, contents: string | Buffer, type = "0", linkName = ""): Buffer {
  const body = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8);
  header.write("0000000\0", 108, 8);
  header.write("0000000\0", 116, 8);
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  header.write("00000000000\0", 136, 12);
  header.fill(32, 148, 156);
  header.write(type, 156, 1);
  header.write(linkName, 157, 100, "utf8");
  header.write("ustar\0", 257, 6);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

function paxPath(path: string): string {
  const value = ` path=${path}\n`;
  let length = Buffer.byteLength(value) + 1;
  while (true) {
    const record = `${length}${value}`;
    if (Buffer.byteLength(record) === length) return record;
    length = Buffer.byteLength(record);
  }
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

test("tar extraction handles PAX paths and skips symbolic links", async () => {
  const repo = parseGithubUrl("https://github.com/owner/repo");
  const sha = "c".repeat(40);
  const longPath = `repo-commit/src/${"nested/".repeat(18)}index.ts`;
  const archive = gzipSync(Buffer.concat([
    tarFile("repo-commit/PaxHeader", paxPath(longPath), "x"),
    tarFile("repo-commit/placeholder.ts", "export const value = 1;\n"),
    tarFile("repo-commit/src/link", "", "2", "../../outside"),
    Buffer.alloc(1024),
  ]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/commits/HEAD")
    ? Response.json({ sha }) : new Response(archive);
  try {
    const result = await fetchGithubArchive(repo);
    try {
      assert.equal(await readFile(`${result.directory}/src/${"nested/".repeat(18)}index.ts`, "utf8"),
        "export const value = 1;\n");
      await assert.rejects(lstat(`${result.directory}/src/link`), { code: "ENOENT" });
    } finally { await rm(result.directory, { recursive: true, force: true }); }
  } finally { globalThis.fetch = originalFetch; }
});

test("tar extraction rejects traversal paths", async () => {
  const repo = parseGithubUrl("https://github.com/owner/repo");
  const sha = "d".repeat(40);
  const archive = gzipSync(Buffer.concat([
    tarFile("repo-commit/../outside.ts", "export const escaped = true;\n"),
    Buffer.alloc(1024),
  ]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/commits/HEAD")
    ? Response.json({ sha }) : new Response(archive);
  try {
    await assert.rejects(fetchGithubArchive(repo), /unsafe path/);
  } finally { globalThis.fetch = originalFetch; }
});
