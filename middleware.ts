import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookies";
import { PUBLIC_ERROR_DEFINITIONS } from "@/lib/contracts/investigation-api";

const PROTECTED_PAGE_PREFIXES = ["/investigations"];
const PUBLIC_API_PREFIXES = ["/api/auth/"];

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isProtectedApi(pathname: string): boolean {
  return pathname.startsWith("/api/v1/") && !PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(request.cookies.get(SESSION_COOKIE)?.value);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isProtectedApi(pathname) && !hasSessionCookie(request)) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: PUBLIC_ERROR_DEFINITIONS.unauthenticated.publicMessage } },
      { status: 401 },
    );
  }

  if (isProtectedPage(pathname) && !hasSessionCookie(request)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/investigations/:path*", "/api/v1/:path*"],
};
