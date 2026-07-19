import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/types";
import { generateSessionToken, sha256Hex } from "./crypto";
import { toSessionUser, type SessionUser, type UserRepository } from "./user-repository";

type Clock = () => Date;

export class SessionRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly users: UserRepository,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async createSession(userId: string, expiresAt: Date): Promise<{ token: string; sessionId: string }> {
    const token = generateSessionToken();
    const sessionId = randomUUID();
    await this.db.insertInto("sessions").values({
      id: sessionId,
      user_id: userId,
      token_hash_sha256: sha256Hex(token),
      expires_at: expiresAt,
      created_at: this.clock(),
    }).execute();
    return { token, sessionId };
  }

  async findUserByToken(token: string): Promise<SessionUser | null> {
    const row = await this.db.selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .select([
        "users.id",
        "users.github_id",
        "users.login",
        "users.display_name",
        "users.avatar_url",
        "users.created_at",
        "users.updated_at",
        "sessions.expires_at",
      ])
      .where("sessions.token_hash_sha256", "=", sha256Hex(token))
      .executeTakeFirst();
    if (!row) return null;
    if (row.expires_at.getTime() <= this.clock().getTime()) return null;
    return toSessionUser({
      id: row.id,
      githubId: row.github_id,
      login: row.login,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async deleteByToken(token: string): Promise<boolean> {
    const result = await this.db.deleteFrom("sessions")
      .where("token_hash_sha256", "=", sha256Hex(token))
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}

export function createSessionRepository(db: Kysely<Database>, users: UserRepository): SessionRepository {
  return new SessionRepository(db, users);
}
