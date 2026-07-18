import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";
import { readDatabaseUrl } from "./config";

let singleton: { db: Kysely<Database>; pool: Pool } | undefined;

export function createDatabase(connectionString = readDatabaseUrl()) {
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  return { db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), pool };
}
export function getDatabase(): Kysely<Database> {
  singleton ??= createDatabase();
  return singleton.db;
}
export async function closeDatabase(): Promise<void> {
  if (!singleton) return;
  await singleton.db.destroy();
  singleton = undefined;
}
