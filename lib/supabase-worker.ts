import "server-only";

import { createClient } from "@supabase/supabase-js";

// The server key, for writes no user token may make. Reads with it bypass row
// security, so every read through it names its organization.
export function createWorkerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_SECRET_KEY for analysis writes.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
