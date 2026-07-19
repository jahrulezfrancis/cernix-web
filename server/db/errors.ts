import { ApplicationError } from "@/server/errors";

const CONNECTION_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT",
]);
const SHUTDOWN_SQLSTATES = new Set(["57P01", "57P02", "57P03"]);

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function classifyDatabaseError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  const code = errorCode(error);
  const unavailable = code !== undefined &&
    (CONNECTION_CODES.has(code) || code.startsWith("08") || SHUTDOWN_SQLSTATES.has(code));
  return new ApplicationError(unavailable ? "dependency_unavailable" : "internal_error", { cause: error });
}
