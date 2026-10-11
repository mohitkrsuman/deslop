import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelCache } from "./client.ts";
import type { Database } from "../database.types.ts";
import { createWorkerClient } from "../supabase-worker.ts";

async function writeEntry(organizationId: string, key: string, entry: Parameters<ModelCache["write"]>[1]) {
  const { error } = await createWorkerClient().from("model_cache").upsert({
    organization_id: organizationId, cache_key: key, task: entry.task, model: entry.model, output: entry.output,
  }, { onConflict: "organization_id,cache_key" });
  if (error) throw error;
}

// Reads go through the signed-in user's client, so the policy decides which
// organization's answers are visible. Only the server writes.
export function userModelCache(client: SupabaseClient<Database>, organizationId: string): ModelCache {
  return {
    async read(key) {
      const { data, error } = await client.from("model_cache").select("output").eq("cache_key", key).maybeSingle();
      if (error) throw error;
      return data?.output;
    },
    write: (key, entry) => writeEntry(organizationId, key, entry),
  };
}

// The analysis worker has no user token; it reads with the server key, so it
// must name the organization itself.
export function workerModelCache(organizationId: string): ModelCache {
  const client = createWorkerClient();
  return {
    async read(key) {
      const { data, error } = await client.from("model_cache").select("output")
        .eq("organization_id", organizationId).eq("cache_key", key).maybeSingle();
      if (error) throw error;
      return data?.output as unknown;
    },
    write: (key, entry) => writeEntry(organizationId, key, entry),
  };
}
