import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/types";
import { generateSessionToken, sha256Hex } from "./crypto";
import { SESSION_COOKIE } from "./cookies";

export const TEST_OWNER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function githubIdForUser(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(0, 12);
  return String(parseInt(hex, 16));
}

export async function seedTestOwner(db: Kysely<Database>, userId = TEST_OWNER_USER_ID): Promise<void> {
  const now = new Date();
  await db.insertInto("users").values({
    id: userId,
    github_id: githubIdForUser(userId),
    login: `test-owner-${userId.slice(0, 8)}`,
    display_name: "Test Owner",
    avatar_url: null,
    created_at: now,
    updated_at: now,
  }).onConflict((oc) => oc.column("id").doUpdateSet({
    login: `test-owner-${userId.slice(0, 8)}`,
    updated_at: now,
  })).execute();
}

export async function createTestSession(
  db: Kysely<Database>,
  userId = TEST_OWNER_USER_ID,
  expiresAt = new Date(Date.now() + 60 * 60 * 1000),
): Promise<string> {
  const token = generateSessionToken();
  await db.insertInto("sessions").values({
    id: randomUUID(),
    user_id: userId,
    token_hash_sha256: sha256Hex(token),
    expires_at: expiresAt,
    created_at: new Date(),
  }).execute();
  return `${SESSION_COOKIE}=${token}`;
}

export async function seedAuthenticatedTestOwner(db: Kysely<Database>, userId = TEST_OWNER_USER_ID): Promise<string> {
  await seedTestOwner(db, userId);
  return createTestSession(db, userId);
}
