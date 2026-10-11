"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { PROVIDER_LABELS, isProvider, verifyKey } from "@/lib/ai/client";
import { sealOrganizationKey } from "@/lib/ai/keys";
import { createServerSupabaseClient } from "@/lib/supabase";

export type ModelKeyState = { error?: string; saved?: boolean };

const ADMINS_ONLY = "Only organization admins can change the model key.";

// The admin check here only produces a readable message. The policies on the
// table are what refuse a member, whatever this code says.
export async function saveModelKey(_previous: ModelKeyState, form: FormData): Promise<ModelKeyState> {
  const { orgId, orgRole, userId } = await auth();
  if (!orgId || !userId) return { error: "Choose an organization first." };
  if (orgRole !== "org:admin") return { error: ADMINS_ONLY };
  const provider = form.get("provider");
  const apiKey = String(form.get("apiKey") ?? "").trim();
  if (!isProvider(provider)) return { error: "Choose Claude or OpenAI." };
  if (apiKey.length < 20 || /\s/.test(apiKey)) return { error: `That doesn't look like a ${PROVIDER_LABELS[provider]} key.` };

  try {
    await verifyKey(provider, apiKey);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }

  const row = {
    provider,
    ciphertext: sealOrganizationKey(apiKey, orgId),
    last_four: apiKey.slice(-4),
    updated_at: new Date().toISOString(),
  };
  const client = createServerSupabaseClient();
  const { data: existing, error: readError } = await client.from("model_keys").select("organization_id").maybeSingle();
  if (readError) return { error: readError.message };
  // An update the policy refuses changes no rows rather than failing, so the
  // changed rows are read back to tell the two apart.
  const { data: written, error } = existing
    ? await client.from("model_keys").update(row).eq("organization_id", orgId).select("organization_id")
    : await client.from("model_keys").insert({ organization_id: orgId, ...row }).select("organization_id");
  if (error) return { error: error.code === "42501" ? ADMINS_ONLY : error.message };
  if (!written || written.length === 0) return { error: ADMINS_ONLY };
  revalidatePath("/");
  return { saved: true };
}

export async function removeModelKey(): Promise<ModelKeyState> {
  const { orgId, orgRole, userId } = await auth();
  if (!orgId || !userId) return { error: "Choose an organization first." };
  if (orgRole !== "org:admin") return { error: ADMINS_ONLY };
  const { data, error } = await createServerSupabaseClient().from("model_keys")
    .delete().eq("organization_id", orgId).select("organization_id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "There is no model key to remove." };
  revalidatePath("/");
  return {};
}
