import type { FileNode } from "../types.mts";

const ENTRY_KINDS = new Set([
  "page", "route", "api-route", "layout", "middleware", "proxy", "config",
  "configuration", "entrypoint", "entry-point", "instrumentation",
]);

const APP_ENTRY = /(?:^|\/)app\/(?:.*\/)?(?:page|route|layout|template|loading|error|global-error|not-found|default|sitemap|robots|manifest|icon|apple-icon|opengraph-image|twitter-image)\.(?:[cm]?[jt]sx?)$/;
const PAGES_ENTRY = /(?:^|\/)pages\/.+\.(?:[cm]?[jt]sx?)$/;
const ROOT_HOOK = /^(?:(?:apps|packages|examples)\/[^/]+\/)?(?:src\/)?(?:middleware|proxy|instrumentation|instrumentation-client)\.(?:[cm]?[jt]sx?)$/;

// Keep convention knowledge outside the graph and parser. The fallback
// adapter has no framework kinds, so also recognize conventional entry paths.
// This is an exclusion safeguard, not a claim that other files are unused.
export function isConventionEntryPoint(file: FileNode): boolean {
  if (ENTRY_KINDS.has(file.kind.toLowerCase())) return true;
  const path = file.path.replaceAll("\\", "/");
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (APP_ENTRY.test(path) || PAGES_ENTRY.test(path) || ROOT_HOOK.test(path)) return true;
  if (/^\+(?:page|layout|server|error)(?:\.server)?\.[jt]s$/.test(name) && /(?:^|\/)routes\//.test(path)) return true;
  return /(?:^|[.\-])config(?:[.\-][^.]+)*\.(?:[cm]?[jt]s|json)$/.test(name)
    || /^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(name)
    || /^\..+rc(?:\.[cm]?[jt]s|\.json)?$/.test(name);
}
