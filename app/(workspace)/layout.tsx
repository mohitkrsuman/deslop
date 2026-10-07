import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { Shell } from "@/components/shell";
import { createServerSupabaseClient } from "@/lib/supabase";
import { parseTheme, themeCookie } from "@/lib/theme";

export default async function WorkspaceLayout({
  children,
}: LayoutProps<"/">) {
  await auth.protect();

  const store = await cookies();
  const theme = parseTheme(store.get(themeCookie)?.value);

  // Built on each request so later queries send the Clerk session token.
  // Nothing is queried in this phase. Cookies are read first so a static
  // render bails out before the client asks auth() for that token.
  createServerSupabaseClient();

  return <Shell theme={theme}>{children}</Shell>;
}
