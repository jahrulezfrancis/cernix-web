import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Liveness: process responds. No database, provider, or configuration disclosure. */
export async function GET() {
  return NextResponse.json({ status: "live" }, { status: 200 });
}
