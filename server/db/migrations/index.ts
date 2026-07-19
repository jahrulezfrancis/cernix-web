import type { MigrationProvider } from "kysely";
import { initialMigration } from "./001_initial";
import { repositorySnapshotsMigration } from "./002_repository_snapshots";
import { snapshotWorkerMigration } from "./003_snapshot_worker";
import { investigationPlanningMigration } from "./004_investigation_planning";
import { evidenceCollectionMigration } from "./005_evidence_collection";
import { skepticChallengeMigration } from "./006_skeptic_challenge";
import { judgmentReportMigration } from "./007_judgment_report";
export const migrationProvider: MigrationProvider = {
  async getMigrations() { return { "001_initial": initialMigration, "002_repository_snapshots": repositorySnapshotsMigration,
    "003_snapshot_worker": snapshotWorkerMigration, "004_investigation_planning": investigationPlanningMigration,
    "005_evidence_collection": evidenceCollectionMigration, "006_skeptic_challenge": skepticChallengeMigration,
    "007_judgment_report": judgmentReportMigration }; },
};
