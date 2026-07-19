import { ApplicationError } from "@/server/errors";

export function readDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.DATABASE_URL;
  if (!value) throw new ApplicationError("dependency_unavailable", {});
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
      throw new Error("invalid");
    }
  } catch {
    throw new ApplicationError("dependency_unavailable", {});
  }
  return value;
}
