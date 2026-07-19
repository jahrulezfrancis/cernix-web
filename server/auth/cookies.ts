export const SESSION_COOKIE = "cernix_session";
export const OAUTH_STATE_COOKIE = "cernix_oauth_state";
export const OAUTH_NEXT_COOKIE = "cernix_oauth_next";

type CookieOptions = Readonly<{
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
}>;

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.secure ?? process.env.NODE_ENV === "production") parts.push("Secure");
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join("; ");
}

export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds });
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 });
}

export function buildOAuthStateCookie(state: string): string {
  return serializeCookie(OAUTH_STATE_COOKIE, state, { maxAgeSeconds: 600 });
}

export function buildOAuthNextCookie(next: string): string {
  return serializeCookie(OAUTH_NEXT_COOKIE, encodeURIComponent(next), { maxAgeSeconds: 600 });
}

export function clearOAuthNextCookie(): string {
  return serializeCookie(OAUTH_NEXT_COOKIE, "", { maxAgeSeconds: 0 });
}

export function readOAuthNextCookie(request: Request): string {
  const value = readCookie(request, OAUTH_NEXT_COOKIE);
  if (!value) return "/investigations";
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.startsWith("//") ? decoded : "/investigations";
  } catch {
    return "/investigations";
  }
}

export function clearOAuthStateCookie(): string {
  return serializeCookie(OAUTH_STATE_COOKIE, "", { maxAgeSeconds: 0 });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
