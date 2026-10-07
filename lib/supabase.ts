import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { assertEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

// Builds a server-side Supabase client that sends the signed-in Clerk user's
// token, so row-level security policies decide what it can read.
// Sessions belong to Clerk. @supabase/ssr's cookie client is not used: it would
// refresh a second session in the same middleware slot and sign people out.
export function createServerSupabaseClient() {
  assertEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and publishable key are required.");
  }

  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    accessToken: async () => (await auth()).getToken(),
  });
}
