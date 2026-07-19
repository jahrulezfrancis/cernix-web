import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/types";

export type UserRecord = Readonly<{
  id: string;
  githubId: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SessionUser = Readonly<{
  id: string;
  login: string;
  displayName: string | null;
  avatarUrl: string | null;
}>;

type Clock = () => Date;

function mapUser(row: {
  id: string;
  github_id: string;
  login: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}): UserRecord {
  return {
    id: row.id,
    githubId: row.github_id,
    login: row.login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSessionUser(user: UserRecord): SessionUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

export class UserRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: Clock = () => new Date()) {}

  async upsertFromGitHub(profile: Readonly<{
    githubId: number;
    login: string;
    displayName: string | null;
    avatarUrl: string | null;
  }>): Promise<UserRecord> {
    const now = this.clock();
    const existing = await this.db.selectFrom("users").selectAll()
      .where("github_id", "=", String(profile.githubId))
      .executeTakeFirst();
    if (existing) {
      const updated = await this.db.updateTable("users").set({
        login: profile.login,
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
        updated_at: now,
      }).where("id", "=", existing.id).returningAll().executeTakeFirstOrThrow();
      return mapUser(updated);
    }
    const created = await this.db.insertInto("users").values({
      id: randomUUID(),
      github_id: String(profile.githubId),
      login: profile.login,
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl,
      created_at: now,
      updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    return mapUser(created);
  }

  async getById(userId: string): Promise<UserRecord | null> {
    const row = await this.db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirst();
    return row ? mapUser(row) : null;
  }
}
