"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { parseTheme, themeCookie, type Theme } from "@/lib/theme";

export async function setTheme(theme: Theme) {
  await auth.protect();

  const value = parseTheme(theme);
  const store = await cookies();
  store.set(themeCookie, value, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}
