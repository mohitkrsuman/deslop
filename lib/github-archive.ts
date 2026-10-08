import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_FILES = 12000;
const MAX_PAX_BYTES = 1024 * 1024;

export function parseGithubUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a valid GitHub repository URL."); }
  const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
      parts.length !== 2 || !parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part))) {
    throw new Error("Enter a public GitHub repository URL, such as https://github.com/owner/repo.");
  }
  const owner = parts[0].toLowerCase();
  const repo = parts[1].replace(/\.git$/i, "").toLowerCase();
  if (!repo || repo === "." || repo === "..") throw new Error("Enter a valid repository name.");
  return { owner, repo, name: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

function checkArchiveResponse(response: Response) {
  if (!response.ok) {
    if (response.status === 404) throw new Error("Repository not found or is not public.");
    if (response.status === 403 || response.status === 429) throw new Error("GitHub rate limit reached. Try again later.");
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error("GitHub returned an empty archive.");
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Repository archive exceeds the 1 GB download limit.");
  }
}

async function downloadArchive(response: Response, archivePath: string) {
  checkArchiveResponse(response);
  const reader = response.body!.getReader();
  let size = 0;
  async function* chunks() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_ARCHIVE_BYTES) {
          throw new Error("Repository archive exceeds the 1 GB download limit.");
        }
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  await pipeline(Readable.from(chunks()), createWriteStream(archivePath));
}

function tarText(bytes: Buffer, start: number, length: number): string {
  return bytes.subarray(start, start + length).toString("utf8").split("\0", 1)[0];
}

class TarReader {
  private iterator: AsyncIterator<Buffer>;
  private current = Buffer.alloc(0);
  private offset = 0;
  private unpackedBytes = 0;

  constructor(chunks: AsyncIterable<Buffer>) {
    this.iterator = chunks[Symbol.asyncIterator]();
  }

  async take(maxBytes: number): Promise<Buffer | null> {
    while (this.offset === this.current.length) {
      const next = await this.iterator.next();
      if (next.done) return null;
      this.current = Buffer.from(next.value);
      this.offset = 0;
      this.unpackedBytes += this.current.length;
      if (this.unpackedBytes > MAX_UNPACKED_BYTES) {
        throw new Error("Repository archive exceeds the 8 GB unpacked limit.");
      }
    }
    const chunk = this.current.subarray(this.offset, this.offset + maxBytes);
    this.offset += chunk.length;
    return chunk;
  }

  async exactly(length: number): Promise<Buffer | null> {
    const parts: Buffer[] = [];
    let remaining = length;
    while (remaining > 0) {
      const chunk = await this.take(remaining);
      if (!chunk) {
        if (remaining === length) return null;
        throw new Error("GitHub returned an invalid archive.");
      }
      parts.push(chunk);
      remaining -= chunk.length;
    }
    return Buffer.concat(parts, length);
  }

  async skip(length: number) {
    let remaining = length;
    while (remaining > 0) {
      const chunk = await this.take(remaining);
      if (!chunk) throw new Error("GitHub returned an invalid archive.");
      remaining -= chunk.length;
    }
  }
}

async function extractArchive(archivePath: string, directory: string) {
  const source = createReadStream(archivePath);
  const gunzip = createGunzip();
  source.on("error", (error) => gunzip.destroy(error));
  source.pipe(gunzip);
  const reader = new TarReader(gunzip);
  let count = 0;
  let pendingPath: string | null = null;

  try {
    while (true) {
      const header = await reader.exactly(512);
      if (!header) break;
      if (header.every((value) => value === 0)) {
        // Read the gzip trailer as well, so truncated or corrupt downloads fail.
        while (await reader.take(64 * 1024)) { /* drain */ }
        break;
      }
      const rawSize = tarText(header, 124, 12).trim();
      const size = Number.parseInt(rawSize || "0", 8);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UNPACKED_BYTES) {
        throw new Error("GitHub returned an invalid archive.");
      }

      const type = String.fromCharCode(header[156]);
      const name = pendingPath ?? [tarText(header, 345, 155), tarText(header, 0, 100)].filter(Boolean).join("/");
      pendingPath = null;

      if (type === "x") {
        if (size > MAX_PAX_BYTES) throw new Error("GitHub returned an invalid archive.");
        const body = await reader.exactly(size);
        if (!body) throw new Error("GitHub returned an invalid archive.");
        const match = body.toString("utf8").match(/(?:^|\n)\d+ path=([^\n]+)/);
        pendingPath = match?.[1] ?? null;
      } else if (type === "0" || type === "\0" || type === "5") {
        const relative = name.split("/").slice(1).join("/");
        const segments = relative.split("/").filter(Boolean);
        if (segments.some((part) => part === ".." || part === "." || part.includes("\\")) || path.isAbsolute(relative)) {
          throw new Error("GitHub archive contains an unsafe path.");
        }
        if (segments.length > 0) {
          const destination = path.join(directory, ...segments);
          if (type === "5") {
            await mkdir(destination, { recursive: true });
          } else {
            count += 1;
            if (count > MAX_FILES) throw new Error("Repository has too many files to analyze.");
            await mkdir(path.dirname(destination), { recursive: true });
            const file = await open(destination, "w");
            try {
              let remaining = size;
              while (remaining > 0) {
                const chunk = await reader.take(remaining);
                if (!chunk) throw new Error("GitHub returned an invalid archive.");
                let written = 0;
                while (written < chunk.length) {
                  const result = await file.write(chunk, written, chunk.length - written);
                  written += result.bytesWritten;
                }
                remaining -= chunk.length;
              }
            } finally {
              await file.close();
            }
          }
        } else {
          await reader.skip(size);
        }
        if (type === "5") await reader.skip(size);
      } else {
        await reader.skip(size);
      }
      await reader.skip((512 - size % 512) % 512);
    }
    if (count === 0) throw new Error("Repository archive contains no files.");
  } finally {
    gunzip.destroy();
    source.destroy();
  }
}

export async function fetchGithubArchive(repository: ReturnType<typeof parseGithubUrl>) {
  const api = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/commits/HEAD`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "deslop-analysis" },
    signal: AbortSignal.timeout(30000), cache: "no-store",
  });
  if (!api.ok) {
    if (api.status === 404) throw new Error("Repository not found or is not public.");
    if (api.status === 403 || api.status === 429) throw new Error("GitHub rate limit reached. Try again later.");
    throw new Error(`GitHub commit lookup returned HTTP ${api.status}.`);
  }
  const commit = await api.json() as { sha?: unknown };
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) {
    throw new Error("GitHub did not return a commit SHA.");
  }
  const response = await fetch(
    `https://codeload.github.com/${repository.owner}/${repository.repo}/tar.gz/${commit.sha}`,
    { signal: AbortSignal.timeout(10 * 60 * 1000), cache: "no-store" },
  );
  const directory = await mkdtemp(path.join(tmpdir(), "deslop-repo-"));
  const archivePath = `${directory}.tar.gz`;
  try {
    await downloadArchive(response, archivePath);
    await extractArchive(archivePath, directory);
    return { directory, commitSha: commit.sha };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(archivePath, { force: true });
  }
}
