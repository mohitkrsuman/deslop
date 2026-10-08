"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function createBrowserSupabaseClient(getToken: () => Promise<string | null>) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: getToken,
    },
  );
}
