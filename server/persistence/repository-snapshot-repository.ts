import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { InvestigationIdSchema, type BackendLifecycleStatus } from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import type { SnapshotArtifact } from "@/server/github/contracts";
import { PublicInvestigationEventSchema } from "./events";

export type SnapshotInvestigationContext = Readonly<{
  id: string; status: BackendLifecycleStatus; repositoryOwner: string; repositoryName: string;
  requestedRef: string | null;
}>;

export type PersistedRepositorySnapshot = Readonly<{
  id: string; investigationId: string; githubRepositoryId: string; canonicalOwner: string;
  canonicalRepository: string; canonicalUrl: string; defaultBranch: string; requestedRef: string | null;
  resolvedRef: string; commitSha: string; rootTreeSha: string; manifestSchemaVersion: number;
  admissionPolicyVersion: number; manifestHashSha256: string; inspectedEntryCount: number;
  admittedFileCount: number; excludedEntryCount: number; totalAdmittedBytes: string; createdAt: Date;
  entries: readonly PersistedSnapshotEntry[];
}>;

export type PersistedSnapshotEntry = Readonly<{
  id: string; path: string; mode: string; objectType: string; objectSha: string;
  reportedSize: string | null; decision: "admitted" | "excluded"; exclusionReason: string | null;
  manifestOrder: number; file: null | Readonly<{ rawContent: Uint8Array; normalizedText: string;
    rawSha256: string; normalizedSha256: string; byteCount: number; lineCount: number;
    detectedLanguage: string | null }>;
}>;

type IdGenerator = () => string;
type Clock = () => Date;

async function loadSnapshot(db: Kysely<Database> | Transaction<Database>, investigationId: string): Promise<PersistedRepositorySnapshot | null> {
  const snapshot = await db.selectFrom("repository_snapshots").selectAll().where("investigation_id", "=", investigationId).executeTakeFirst();
  if (!snapshot) return null;
  const rows = await db.selectFrom("repository_snapshot_entries")
    .leftJoin("repository_snapshot_files", "repository_snapshot_files.entry_id", "repository_snapshot_entries.id")
    .select([
      "repository_snapshot_entries.id", "path", "mode", "object_type", "object_sha", "reported_size", "decision", "exclusion_reason", "manifest_order",
      "raw_content", "normalized_text", "raw_sha256", "normalized_sha256", "byte_count", "line_count", "detected_language",
    ]).where("repository_snapshot_entries.snapshot_id", "=", snapshot.id).orderBy("manifest_order", "asc").execute();
  return {
    id: snapshot.id, investigationId: snapshot.investigation_id, githubRepositoryId: snapshot.github_repository_id,
    canonicalOwner: snapshot.canonical_owner, canonicalRepository: snapshot.canonical_repository,
    canonicalUrl: snapshot.canonical_url, defaultBranch: snapshot.default_branch,
    requestedRef: snapshot.requested_ref, resolvedRef: snapshot.resolved_ref,
    commitSha: snapshot.commit_sha, rootTreeSha: snapshot.root_tree_sha,
    manifestSchemaVersion: snapshot.manifest_schema_version, admissionPolicyVersion: snapshot.admission_policy_version,
    manifestHashSha256: snapshot.manifest_hash_sha256, inspectedEntryCount: snapshot.inspected_entry_count,
    admittedFileCount: snapshot.admitted_file_count, excludedEntryCount: snapshot.excluded_entry_count,
    totalAdmittedBytes: snapshot.total_admitted_bytes, createdAt: snapshot.created_at,
    entries: rows.map((row) => ({
      id: row.id, path: row.path, mode: row.mode, objectType: row.object_type, objectSha: row.object_sha,
      reportedSize: row.reported_size, decision: row.decision, exclusionReason: row.exclusion_reason,
      manifestOrder: row.manifest_order,
      file: row.raw_content === null ? null : {
        rawContent: row.raw_content, normalizedText: row.normalized_text!, rawSha256: row.raw_sha256!,
        normalizedSha256: row.normalized_sha256!, byteCount: row.byte_count!, lineCount: row.line_count!,
        detectedLanguage: row.detected_language,
      },
    })),
  };
}

export class RepositorySnapshotRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: Clock = () => new Date(), private readonly id: IdGenerator = randomUUID) {}

  async loadInvestigationContext(rawId: unknown): Promise<SnapshotInvestigationContext> {
    const id = InvestigationIdSchema.parse(rawId);
    try {
      const row = await this.db.selectFrom("investigations").innerJoin("manual_claims", "manual_claims.investigation_id", "investigations.id")
        .select(["investigations.id", "status", "repository_owner", "repository_name", "requested_ref"])
        .where("investigations.id", "=", id).executeTakeFirst();
      if (!row) throw new ApplicationError("not_found", {});
      return { id: row.id, status: row.status, repositoryOwner: row.repository_owner, repositoryName: row.repository_name, requestedRef: row.requested_ref };
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async findByInvestigation(rawId: unknown): Promise<PersistedRepositorySnapshot | null> {
    const id = InvestigationIdSchema.parse(rawId);
    try { return await loadSnapshot(this.db, id); }
    catch (error) { throw classifyDatabaseError(error); }
  }

  async createForInvestigation(rawId: unknown, artifact: SnapshotArtifact): Promise<PersistedRepositorySnapshot> {
    const investigationId = InvestigationIdSchema.parse(rawId);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const investigation = await tx.selectFrom("investigations").select(["id", "status"])
          .where("id", "=", investigationId).forUpdate().executeTakeFirst();
        if (!investigation) throw new ApplicationError("not_found", {});
        const existing = await loadSnapshot(tx, investigationId);
        if (existing) return existing;
        if (investigation.status !== "snapshotting") throw new ApplicationError("invalid_lifecycle_transition", {});
        const now = this.clock(), snapshotId = this.id();
        await tx.insertInto("repository_snapshots").values({
          id: snapshotId, investigation_id: investigationId, github_repository_id: artifact.githubRepositoryId,
          canonical_owner: artifact.canonicalOwner, canonical_repository: artifact.canonicalRepository,
          canonical_url: artifact.canonicalUrl, default_branch: artifact.defaultBranch,
          requested_ref: artifact.requestedRef, resolved_ref: artifact.resolvedRef,
          commit_sha: artifact.commitSha, root_tree_sha: artifact.rootTreeSha,
          manifest_schema_version: artifact.manifestSchemaVersion, admission_policy_version: artifact.admissionPolicyVersion,
          manifest_hash_sha256: artifact.manifestHashSha256, inspected_entry_count: artifact.inspectedEntryCount,
          admitted_file_count: artifact.admittedFileCount, excluded_entry_count: artifact.excludedEntryCount,
          total_admitted_bytes: artifact.totalAdmittedBytes, created_at: now,
        }).execute();
        const entryRows = artifact.entries.map((entry, manifestOrder) => ({
          id: this.id(), snapshot_id: snapshotId, path: entry.path, mode: entry.mode,
          object_type: entry.type, object_sha: entry.objectSha, reported_size: entry.reportedSize,
          decision: entry.decision, exclusion_reason: entry.exclusionReason, manifest_order: manifestOrder,
        }));
        if (entryRows.length) await tx.insertInto("repository_snapshot_entries").values(entryRows).execute();
        const fileRows = artifact.entries.flatMap((entry, index) => {
          if (entry.decision !== "admitted") return [];
          if (!entry.rawContent || entry.normalizedText === undefined || !entry.rawSha256 || !entry.normalizedSha256 || entry.byteCount === null || entry.lineCount === null) {
            throw new ApplicationError("internal_error", {});
          }
          return [{
            id: this.id(), snapshot_id: snapshotId, entry_id: entryRows[index].id,
            raw_content: entry.rawContent, normalized_text: entry.normalizedText,
            raw_sha256: entry.rawSha256, normalized_sha256: entry.normalizedSha256,
            byte_count: entry.byteCount, line_count: entry.lineCount,
            detected_language: entry.detectedLanguage ?? null, created_at: now,
          }];
        });
        if (fileRows.length) await tx.insertInto("repository_snapshot_files").values(fileRows).execute();
        const event = PublicInvestigationEventSchema.parse({
          type: "repository_snapshot_persisted", stage: "snapshotting",
          payload: { commitSha: artifact.commitSha, manifestHash: artifact.manifestHashSha256,
            inspectedEntryCount: artifact.inspectedEntryCount, admittedFileCount: artifact.admittedFileCount,
            excludedEntryCount: artifact.excludedEntryCount, totalAdmittedBytes: artifact.totalAdmittedBytes },
        });
        await tx.insertInto("investigation_events").values({
          investigation_id: investigationId, type: event.type, stage: event.stage,
          public_payload: JSON.stringify(event.payload), created_at: now,
        }).execute();
        const created = await loadSnapshot(tx, investigationId);
        if (!created) throw new ApplicationError("internal_error", {});
        return created;
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "23505") {
        const winner = await this.findByInvestigation(investigationId);
        if (winner) return winner;
      }
      throw classifyDatabaseError(error);
    }
  }
}
