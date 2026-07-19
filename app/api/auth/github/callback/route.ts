import { NextResponse } from "next/server";
import {
  buildSessionCookie,
  clearOAuthNextCookie,
  clearOAuthStateCookie,
  readCookie,
  readOAuthNextCookie,
  OAUTH_STATE_COOKIE,
} from "@/server/auth/cookies";
import { getAuthConfig } from "@/server/auth/config";
import { exchangeGitHubCode, fetchGitHubUserProfile } from "@/server/auth/github-oauth";
import { getDatabase } from "@/server/db/database";
import { recordSecurityEvent } from "@/server/auth/security-events";
import { sessionRepositorySingleton, userRepositorySingleton } from "@/server/auth/repositories";
import { getClientIp } from "@/server/http/auth";
import { checkRateLimit } from "@/server/http/rate-limit";
import { safeEqual } from "@/server/auth/crypto";
import { ApplicationError } from "@/server/errors";

export async function GET(request: Request) {
  const authConfig = getAuthConfig();
  const loginUrl = new URL("/login", authConfig.appUrl);
  try {
    checkRateLimit(`auth-callback:${getClientIp(request)}`, { limit: 30, windowMs: 60_000 });
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const storedState = readCookie(request, OAUTH_STATE_COOKIE);
    if (!code || !state || !storedState || !safeEqual(state, storedState)) {
      throw new ApplicationError("malformed_input", {});
    }
    const accessToken = await exchangeGitHubCode(code);
    const profile = await fetchGitHubUserProfile(accessToken);
    const users = userRepositorySingleton();
    const user = await users.upsertFromGitHub({
      githubId: profile.id,
      login: profile.login,
      displayName: profile.name,
      avatarUrl: profile.avatar_url,
    });
    const expiresAt = new Date(Date.now() + authConfig.sessionMaxAgeSeconds * 1000);
    const { token } = await sessionRepositorySingleton().createSession(user.id, expiresAt);
    await recordSecurityEvent(getDatabase(), {
      userId: user.id,
      eventType: "login_success",
      metadata: { provider: "github", login: user.login },
    });
    const redirectTarget = new URL(readOAuthNextCookie(request), authConfig.appUrl);
    const response = NextResponse.redirect(redirectTarget);
    response.headers.append("Set-Cookie", buildSessionCookie(token, authConfig.sessionMaxAgeSeconds));
    response.headers.append("Set-Cookie", clearOAuthStateCookie());
    response.headers.append("Set-Cookie", clearOAuthNextCookie());
    return response;
  } catch (error) {
    await recordSecurityEvent(getDatabase(), {
      eventType: "login_failure",
      metadata: { provider: "github" },
    }).catch(() => undefined);
    loginUrl.searchParams.set("error", error instanceof ApplicationError ? error.code : "oauth_callback_failed");
    const response = NextResponse.redirect(loginUrl);
    response.headers.append("Set-Cookie", clearOAuthStateCookie());
    return response;
  }
}
