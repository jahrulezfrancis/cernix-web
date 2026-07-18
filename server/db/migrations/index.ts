import type { MigrationProvider } from "kysely";
import { initialMigration } from "./001_initial";
export const migrationProvider: MigrationProvider = {
  async getMigrations() { return { "001_initial": initialMigration }; },
};
