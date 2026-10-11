import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Long enough for a multi-tool answer, short enough that a leaked token is
// worthless soon after. The insert policy refuses anything over 15 minutes.
const GRANT_LIFETIME_MS = 10 * 60 * 1000;

export const GRANT_HEADER = "x-agent-grant";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Minted through the asker's own client: if row security doesn't show them the
// analysis, there is nothing to grant and the insert policy would refuse anyway.
export async function mintAgentGrant(client: SupabaseClient<Database>, analysisId: string): Promise<string | null> {
  const { data: analysis, error } = await client.from("analyses")
    .select("id,organization_id,status").eq("id", analysisId).maybeSingle();
  if (error) throw error;
  if (!analysis || analysis.status !== "complete") return null;

  const token = randomBytes(32).toString("base64url");
  const { error: insertError } = await client.from("agent_grants").insert({
    token_hash: hashToken(token),
    analysis_id: analysis.id,
    organization_id: analysis.organization_id,
    expires_at: new Date(Date.now() + GRANT_LIFETIME_MS).toISOString(),
  });
  if (insertError) throw insertError;
  return token;
}

// The publishable key plus the grant header. The anon policies match the header
// to an unexpired grant, so this client sees one analysis or nothing.
export function createGrantClient(token: string): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and publishable key are required.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { [GRANT_HEADER]: token } },
  });
}
