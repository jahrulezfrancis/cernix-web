import type { MigrationProvider } from "kysely";
import { initialMigration } from "./001_initial";
import { repositorySnapshotsMigration } from "./002_repository_snapshots";
export const migrationProvider: MigrationProvider = {
  async getMigrations() { return { "001_initial": initialMigration, "002_repository_snapshots": repositorySnapshotsMigration }; },
};
