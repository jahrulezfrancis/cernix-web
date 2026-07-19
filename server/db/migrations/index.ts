import type { MigrationProvider } from "kysely";
import { initialMigration } from "./001_initial";
import { repositorySnapshotsMigration } from "./002_repository_snapshots";
import { snapshotWorkerMigration } from "./003_snapshot_worker";
export const migrationProvider: MigrationProvider = {
  async getMigrations() { return { "001_initial": initialMigration, "002_repository_snapshots": repositorySnapshotsMigration,
    "003_snapshot_worker": snapshotWorkerMigration }; },
};
