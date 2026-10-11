import "server-only";

import { secret } from "./ai/keys.ts";
import { openKey, sealKey } from "./ai/sealed-key.ts";
import type { GithubToken } from "./github-archive.ts";
import { createWorkerClient } from "./supabase-worker.ts";

// Bound to its purpose as well as the organization, so a sealed model key
// copied into this table fails to open rather than being sent to GitHub.
function binding(organizationId: string): string {
  return `github-token:${organizationId}`;
}

export function sealGithubToken(token: string, organizationId: string): string {
  return sealKey(token, binding(organizationId), secret());
}

// No user token can read the sealed column, so this goes through the server
// key and names the organization itself. The caller must already have proven
// the organization through the user's own token, or be the pipeline running
// for it. Null means the organization has set no token.
export async function githubTokenFor(organizationId: string): Promise<GithubToken> {
  const { data, error } = await createWorkerClient().from("github_tokens")
    .select("ciphertext").eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  try {
    return openKey(data.ciphertext, binding(organizationId), secret());
  } catch {
    throw new Error("The organization's GitHub token can't be decrypted. An admin needs to save it again.");
  }
}

// Reads that need GitHub again for an analysis: its organization's token when
// one is set. A private repository without one fails here with the reason,
// rather than as a "not found" from an anonymous read.
export async function githubTokenForAnalysis(organizationId: string, isPrivate: boolean): Promise<GithubToken> {
  const token = await githubTokenFor(organizationId);
  if (isPrivate && !token) {
    throw new Error("This is a private repository and the organization has no GitHub token set. An admin needs to add one.");
  }
  return token;
}
