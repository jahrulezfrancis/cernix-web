import { ApplicationError } from "@/server/errors";
import { readCookie } from "@/server/auth/cookies";
import { SESSION_COOKIE } from "@/server/auth/cookies";
import { sessionRepositorySingleton } from "@/server/auth/repositories";
import type { SessionUser } from "@/server/auth/user-repository";

export async function resolveSession(request: Request): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return sessionRepositorySingleton().findUserByToken(token);
}

export async function requireSession(request: Request): Promise<SessionUser> {
  const session = await resolveSession(request);
  if (!session) throw new ApplicationError("unauthenticated", {});
  return session;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}
