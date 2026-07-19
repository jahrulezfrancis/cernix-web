import { NextResponse } from "next/server";
import { clearSessionCookie, readCookie, SESSION_COOKIE } from "@/server/auth/cookies";
import { getDatabase } from "@/server/db/database";
import { recordSecurityEvent } from "@/server/auth/security-events";
import { sessionRepositorySingleton } from "@/server/auth/repositories";
import { resolveSession } from "@/server/http/auth";
import { handleRoute } from "@/server/http/route";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const session = await resolveSession(request);
    const token = readCookie(request, SESSION_COOKIE);
    if (token) await sessionRepositorySingleton().deleteByToken(token);
    if (session) {
      await recordSecurityEvent(getDatabase(), {
        userId: session.id,
        eventType: "logout",
        metadata: { login: session.login },
      });
    }
    const response = NextResponse.json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie());
    return response;
  });
}
