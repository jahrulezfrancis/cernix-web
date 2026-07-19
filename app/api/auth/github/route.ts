import { NextResponse } from "next/server";
import { generateOAuthState } from "@/server/auth/crypto";
import {
  buildOAuthNextCookie,
  buildOAuthStateCookie,
  OAUTH_NEXT_COOKIE,
} from "@/server/auth/cookies";
import { getAuthConfig } from "@/server/auth/config";
import { buildGitHubAuthorizeUrl } from "@/server/auth/github-oauth";
import { getClientIp } from "@/server/http/auth";
import { checkRateLimit } from "@/server/http/rate-limit";
import { ApplicationError } from "@/server/errors";

export async function GET(request: Request) {
  try {
    checkRateLimit(`auth-github:${getClientIp(request)}`, { limit: 30, windowMs: 60_000 });
    const url = new URL(request.url);
    const next = url.searchParams.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/investigations";
    const state = generateOAuthState();
    const response = NextResponse.redirect(buildGitHubAuthorizeUrl(state));
    response.headers.append("Set-Cookie", buildOAuthStateCookie(state));
    response.headers.append("Set-Cookie", buildOAuthNextCookie(safeNext));
    return response;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "rate_limited") {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 429 });
    }
    return NextResponse.redirect(new URL("/login?error=oauth_start_failed", getAuthConfig().appUrl));
  }
}

export async function POST() {
  return NextResponse.json({ error: { code: "malformed_input", message: "Use GET to start GitHub sign-in." } }, { status: 405 });
}
