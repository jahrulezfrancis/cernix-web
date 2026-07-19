import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/types";

export type SecurityEventType =
  | "login_success"
  | "login_failure"
  | "logout"
  | "session_expired"
  | "rate_limited";

export async function recordSecurityEvent(
  db: Kysely<Database>,
  input: Readonly<{
    userId?: string | null;
    eventType: SecurityEventType;
    metadata?: Record<string, string | number | boolean | null>;
    createdAt?: Date;
  }>,
): Promise<void> {
  await db.insertInto("security_events").values({
    id: randomUUID(),
    user_id: input.userId ?? null,
    event_type: input.eventType,
    metadata: JSON.stringify(input.metadata ?? {}),
    created_at: input.createdAt ?? new Date(),
  }).execute();
}
