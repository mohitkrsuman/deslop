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
    throw new Error("Enter a GitHub repository URL, such as https://github.com/owner/repo.");
  }
  const owner = parts[0].toLowerCase();
  const repo = parts[1].replace(/\.git$/i, "").toLowerCase();
  if (!repo || repo === "." || repo === "..") throw new Error("Enter a valid repository name.");
  return { owner, repo, name: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

// A fine-grained token, or null to read anonymously. Whoever calls decides
// which; nothing here falls back from one to the other, because retrying a
// rejected token anonymously hides a broken setup and, for a private
// repository, fails with a misleading reason anyway.
export type GithubToken = string | null;

function headers(token: GithubToken, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Accept: accept, "User-Agent": "deslop-analysis", "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubMessage(response: Response, token: GithubToken): Promise<string> {
  let message = "";
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") message = body.message;
  } catch { /* No JSON body; the status says enough. */ }
  return token ? message.split(token).join("[token]") : message;
}

// GitHub answers "not found" both for a repository that doesn't exist and for
// one the caller can't see, so the message says both.
async function githubFailure(response: Response, token: GithubToken, what: string): Promise<Error> {
  const message = await githubMessage(response, token);
  const reason = message ? ` ${message}.` : "";
  if (response.status === 404) {
    return new Error(token
      ? "Repository not found, or the organization's GitHub token can't read it. GitHub answers the same for both; the token most likely wasn't given this repository."
      : "Repository not found or is not public.");
  }
  if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
    return new Error("GitHub rate limit reached. Try again later.");
  }
  if (token && response.status === 401) return new Error(`GitHub rejected the organization's token.${reason} An admin needs to replace it.`);
  if (token && response.status === 403) return new Error(`GitHub refused the organization's token.${reason}`);
  if (response.status === 403) return new Error("GitHub rate limit reached. Try again later.");
  return new Error(`GitHub ${what} returned HTTP ${response.status}.${reason}`);
}

async function checkArchiveResponse(response: Response, token: GithubToken) {
  if (!response.ok) throw await githubFailure(response, token, "archive download");
  if (!response.body) throw new Error("GitHub returned an empty archive.");
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Repository archive exceeds the 1 GB download limit.");
  }
}

async function downloadArchive(response: Response, archivePath: string, token: GithubToken) {
  await checkArchiveResponse(response, token);
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

type Repository = ReturnType<typeof parseGithubUrl>;

export async function fetchHeadCommit(repository: Repository, token: GithubToken): Promise<string> {
  const api = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/commits/HEAD`, {
    headers: headers(token), signal: AbortSignal.timeout(30000), cache: "no-store",
  });
  if (!api.ok) throw await githubFailure(api, token, "commit lookup");
  const commit = await api.json() as { sha?: unknown };
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) {
    throw new Error("GitHub did not return a commit SHA.");
  }
  return commit.sha;
}

// Whether GitHub itself says the repository is private. Only asked with a
// token: an anonymous read can only ever see a public repository.
async function fetchPrivate(repository: Repository, token: string): Promise<boolean> {
  const api = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}`, {
    headers: headers(token), signal: AbortSignal.timeout(30000), cache: "no-store",
  });
  if (!api.ok) throw await githubFailure(api, token, "repository lookup");
  const body = await api.json() as { private?: unknown };
  if (typeof body.private !== "boolean") throw new Error("GitHub did not say whether the repository is private.");
  return body.private;
}

// One file's bytes at an exact commit, or null when the commit has no such file.
// Fetched by SHA rather than branch, so a CDN-cached copy can't be out of date.
// Anonymous reads use the raw host, which doesn't count against the API's
// hourly limit; reads with a token go through the contents API, which is
// where fine-grained tokens are documented to work.
export async function fetchFileAtCommit(repository: Repository, commitSha: string, filePath: string, token: GithubToken): Promise<Buffer | null> {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const response = token
    ? await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/contents/${encoded}?ref=${commitSha}`, {
      headers: headers(token, "application/vnd.github.raw+json"), signal: AbortSignal.timeout(30000), cache: "no-store",
    })
    : await fetch(`https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/${commitSha}/${encoded}`, {
      signal: AbortSignal.timeout(30000), cache: "no-store",
    });
  if (response.status === 404) return null;
  if (!response.ok) throw await githubFailure(response, token, `read of ${filePath}`);
  return Buffer.from(await response.arrayBuffer());
}

// With a token the archive comes from the API, which redirects to a
// short-lived signed download; the token itself isn't sent past the redirect.
export async function fetchGithubArchive(repository: Repository, token: GithubToken) {
  const isPrivate = token ? await fetchPrivate(repository, token) : false;
  const commitSha = await fetchHeadCommit(repository, token);
  const response = token
    ? await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repo}/tarball/${commitSha}`, {
      headers: headers(token), signal: AbortSignal.timeout(10 * 60 * 1000), cache: "no-store",
    })
    : await fetch(
      `https://codeload.github.com/${repository.owner}/${repository.repo}/tar.gz/${commitSha}`,
      { signal: AbortSignal.timeout(10 * 60 * 1000), cache: "no-store" },
    );
  const directory = await mkdtemp(path.join(tmpdir(), "deslop-repo-"));
  const archivePath = `${directory}.tar.gz`;
  try {
    await downloadArchive(response, archivePath, token);
    await extractArchive(archivePath, directory);
    return { directory, commitSha, private: isPrivate };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(archivePath, { force: true });
  }
}

const FINE_GRAINED = /^github_pat_[A-Za-z0-9_]{20,}$/;

// Refused before GitHub is asked: a classic token can't be limited to chosen
// repositories, and its repo scope includes write access the app never needs.
export function tokenFormatProblem(token: string): string | null {
  if (FINE_GRAINED.test(token)) return null;
  if (/^ghp_/.test(token)) {
    return "That is a classic token. Classic tokens can't be limited to chosen repositories and carry write access, so only fine-grained tokens (starting github_pat_) with read-only Contents are accepted.";
  }
  return "That doesn't look like a fine-grained GitHub token. They start with github_pat_.";
}

// The smallest call that proves GitHub accepts the token: the rate limit
// endpoint needs no permission and costs nothing against the limit. Returns
// when GitHub says the token expires, or null when it doesn't say.
export async function verifyGithubToken(token: string): Promise<Date | null> {
  const response = await fetch("https://api.github.com/rate_limit", {
    headers: headers(token), signal: AbortSignal.timeout(30000), cache: "no-store",
  });
  if (response.status === 401) {
    const message = await githubMessage(response, token);
    throw new Error(`GitHub rejected this token.${message ? ` ${message}.` : ""}`);
  }
  if (!response.ok) throw await githubFailure(response, token, "token check");
  // Sent as "2026-11-10 12:00:00 UTC". Anything else is treated as unreported.
  const header = response.headers.get("github-authentication-token-expiration")?.trim();
  const match = header?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/);
  if (!match) return null;
  const expires = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(expires.getTime()) ? null : expires;
}
