import { NextResponse } from "next/server";
import { sql } from "kysely";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READY_TIMEOUT_MS = 2_000;

/** Readiness: bounded PostgreSQL check only. Never exposes raw errors. */
export async function GET() {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("ready_timeout")), READY_TIMEOUT_MS);
  });
  try {
    const db = getDatabase();
    await Promise.race([sql`select 1`.execute(db), timeout]);
    return NextResponse.json({ status: "ready" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
