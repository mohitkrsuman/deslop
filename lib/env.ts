const required = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

// Throws naming every missing variable at once, so a misconfigured setup fails
// loudly at startup instead of on the first request that needs one.
export function assertEnv(): void {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing environment configuration: ${missing.join(", ")}. Set them before the app starts.`,
    );
  }
}
