import { Migrator, type Kysely } from "kysely";
import type { Database } from "./types";
import { migrationProvider } from "./migrations";

export async function migrateToLatest(db: Kysely<Database>) {
  const result = await new Migrator({ db, provider: migrationProvider }).migrateToLatest();
  if (result.error) throw result.error;
  return result.results ?? [];
}
export async function rollbackOne(db: Kysely<Database>) {
  const result = await new Migrator({ db, provider: migrationProvider }).migrateDown();
  if (result.error) throw result.error;
  return result.results ?? [];
}
