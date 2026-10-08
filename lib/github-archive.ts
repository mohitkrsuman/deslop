import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract, type ReadEntry, type Unpack } from "tar";

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_FILES = 12000;

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

async function extractArchive(archivePath: string, directory: string) {
  let files = 0;
  let unpackedBytes = 0;
  await extract({
    file: archivePath,
    cwd: directory,
    strip: 1,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    noMtime: true,
    filter(this: Unpack, entryPath, rawEntry) {
      const entry = rawEntry as ReadEntry;
      const reject = (message: string) => {
        this.abort(new Error(message));
        return false;
      };
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        return reject("GitHub returned an invalid archive.");
      }
      unpackedBytes += 512 + Math.ceil(entry.size / 512) * 512;
      if (unpackedBytes > MAX_UNPACKED_BYTES) {
        return reject("Repository archive exceeds the 8 GB unpacked limit.");
      }

      const segments = entryPath.replace(/\/$/, "").split("/");
      if (path.posix.isAbsolute(entryPath) || path.win32.isAbsolute(entryPath) ||
          segments.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes(":"))) {
        return reject("GitHub archive contains an unsafe path.");
      }
      if (segments.length < 2) return false;
      if (entry.type === "Directory") return true;
      if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "ContiguousFile") return false;
      files += 1;
      if (files > MAX_FILES) return reject("Repository has too many files to analyze.");
      return true;
    },
  });
  if (files === 0) throw new Error("Repository archive contains no files.");
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
