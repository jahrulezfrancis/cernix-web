/**
 * Production process-start validation for the Next.js Node runtime.
 * Runs after the process boots, not during module evaluation at build time.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.CERNIX_SKIP_PRODUCTION_ENV_VALIDATION === "1") return;

  const { readDatabaseUrl } = await import("@/server/db/config");
  const { parseAuthConfig } = await import("@/server/auth/config");
  readDatabaseUrl(process.env);
  parseAuthConfig(process.env);
}
