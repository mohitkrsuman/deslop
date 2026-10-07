import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { assertEnv } from "@/lib/env";
import { parseTheme, themeClassName, themeCookie } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeSlop",
  description: "A map of a repository, read from the code.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  assertEnv();
  const store = await cookies();
  const theme = parseTheme(store.get(themeCookie)?.value);
  const themeClass = themeClassName(theme);

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} ${themeClass} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ClerkProvider afterSignOutUrl="/sign-in">{children}</ClerkProvider>
      </body>
    </html>
  );
}
