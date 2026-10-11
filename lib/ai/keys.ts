import "server-only";

import { MODELS, appChoice, isProvider, type ModelChoice, type Provider } from "./client.ts";
import { openKey, sealKey } from "./sealed-key.ts";
import { createWorkerClient } from "../supabase-worker.ts";

function secret(): Buffer {
  const raw = process.env.MODEL_KEY_SECRET?.trim();
  if (!raw) throw new Error("MODEL_KEY_SECRET is not set in .env.local.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MODEL_KEY_SECRET must be 32 bytes, base64-encoded.");
  return key;
}

export function sealOrganizationKey(apiKey: string, organizationId: string): string {
  return sealKey(apiKey, organizationId, secret());
}

// No user token can read the sealed column, so this goes through the server
// key and names the organization itself. The caller must already have proven
// the organization through the user's own token.
export async function modelFor(organizationId: string): Promise<ModelChoice> {
  const { data, error } = await createWorkerClient().from("model_keys")
    .select("provider,ciphertext").eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  if (!data) return appChoice();
  return organizationChoice(organizationId, data.provider, data.ciphertext);
}

export function organizationChoice(organizationId: string, provider: string, ciphertext: string): ModelChoice & { source: "organization" } {
  if (!isProvider(provider)) throw new Error(`The organization's model key names an unknown provider, ${provider}.`);
  const known: Provider = provider;
  let apiKey: string;
  try {
    apiKey = openKey(ciphertext, organizationId, secret());
  } catch {
    throw new Error("The organization's model key can't be decrypted. An admin needs to save it again.");
  }
  return { provider: known, model: MODELS[known], apiKey, source: "organization" };
}
