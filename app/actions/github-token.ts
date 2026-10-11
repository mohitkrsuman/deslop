"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { tokenFormatProblem, verifyGithubToken } from "@/lib/github-archive";
import { sealGithubToken } from "@/lib/github-token";
import { createServerSupabaseClient } from "@/lib/supabase";

export type GithubTokenState = { error?: string; saved?: boolean };

const ADMINS_ONLY = "Only organization admins can change the GitHub token.";

// The admin check here only produces a readable message. The policies on the
// table are what refuse a member, whatever this code says.
export async function saveGithubToken(_previous: GithubTokenState, form: FormData): Promise<GithubTokenState> {
  const { orgId, orgRole, userId } = await auth();
  if (!orgId || !userId) return { error: "Choose an organization first." };
  if (orgRole !== "org:admin") return { error: ADMINS_ONLY };
  const token = String(form.get("token") ?? "").trim();
  const problem = tokenFormatProblem(token);
  if (problem) return { error: problem };

  let expires: Date | null;
  try {
    expires = await verifyGithubToken(token);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }

  const row = {
    ciphertext: sealGithubToken(token, orgId),
    last_four: token.slice(-4),
    expires_at: expires ? expires.toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const client = createServerSupabaseClient();
  const { data: existing, error: readError } = await client.from("github_tokens").select("organization_id").maybeSingle();
  if (readError) return { error: readError.message };
  // An update the policy refuses changes no rows rather than failing, so the
  // changed rows are read back to tell the two apart.
  const { data: written, error } = existing
    ? await client.from("github_tokens").update(row).eq("organization_id", orgId).select("organization_id")
    : await client.from("github_tokens").insert({ organization_id: orgId, ...row }).select("organization_id");
  if (error) return { error: error.code === "42501" ? ADMINS_ONLY : error.message };
  if (!written || written.length === 0) return { error: ADMINS_ONLY };
  revalidatePath("/");
  return { saved: true };
}

// Analyses already made stay; anything that has to read GitHub for a private
// one again fails with the reason.
export async function removeGithubToken(): Promise<GithubTokenState> {
  const { orgId, orgRole, userId } = await auth();
  if (!orgId || !userId) return { error: "Choose an organization first." };
  if (orgRole !== "org:admin") return { error: ADMINS_ONLY };
  const { data, error } = await createServerSupabaseClient().from("github_tokens")
    .delete().eq("organization_id", orgId).select("organization_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "There is no GitHub token to remove." };
  revalidatePath("/");
  return {};
}
