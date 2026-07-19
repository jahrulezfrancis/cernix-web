import { createHash, randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { InvestigationIdSchema, type BackendLifecycleStatus } from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import { ADMISSION_POLICY_VERSION, MANIFEST_SCHEMA_VERSION, type ExclusionReason, type SnapshotArtifact, type SnapshotEntry } from "@/server/github/contracts";
import { canonicalizeManifest } from "@/server/github/manifest";
import { compareUtf8, isUnambiguouslyNormalizedPath } from "@/server/github/file-policy";
import { secretPolicyEvaluator } from "@/server/github/secret-scan";
import { gitBlobSha1 } from "@/server/github/git-object";
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
export function isSnapshotWinnerConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "repository_snapshots_investigation_unique");
}
const SHA1 = /^[0-9a-f]{40}$/, SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const EXCLUSION_REASONS = new Set<ExclusionReason>([
  "tree", "submodule", "symlink", "malformed_git_entry", "unsafe_path", "generated_directory",
  "dependency_directory", "secret_path", "unsupported_file_type", "lockfile", "minified_bundle",
  "source_map", "reported_file_too_large", "file_count_limit", "total_bytes_limit", "file_too_large",
  "binary_content", "invalid_utf8", "secret_detected", "line_count_limit",
]);

function corrupt(): never { throw new ApplicationError("internal_error", {}); }
function safeText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function lines(text: string): number { return text.length === 0 ? 0 : (text.match(/\n/g)?.length ?? 0) + (text.endsWith("\n") ? 0 : 1); }

export function validatePersistedSnapshot(snapshot: PersistedRepositorySnapshot, fileRowCount: number): PersistedRepositorySnapshot {
  if (snapshot.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION || snapshot.admissionPolicyVersion !== ADMISSION_POLICY_VERSION) corrupt();
  if (!UUID.test(snapshot.id) || !UUID.test(snapshot.investigationId) || !/^[1-9]\d{0,18}$/.test(snapshot.githubRepositoryId) || BigInt(snapshot.githubRepositoryId) > 9_223_372_036_854_775_807n) corrupt();
  if (!OWNER.test(snapshot.canonicalOwner) || !REPOSITORY.test(snapshot.canonicalRepository) ||
      snapshot.canonicalUrl !== `https://github.com/${snapshot.canonicalOwner}/${snapshot.canonicalRepository}` ||
      !safeText(snapshot.defaultBranch, 1, 255) || (snapshot.requestedRef !== null && !safeText(snapshot.requestedRef, 1, 255)) ||
      !safeText(snapshot.resolvedRef, 1, 255) || !SHA1.test(snapshot.commitSha) || !SHA1.test(snapshot.rootTreeSha) ||
      snapshot.requestedRef === "." || snapshot.requestedRef === ".." || snapshot.resolvedRef === "." || snapshot.resolvedRef === ".." ||
      !SHA256.test(snapshot.manifestHashSha256) || snapshot.entries.length > 50_000 || !Number.isInteger(snapshot.inspectedEntryCount) ||
      !Number.isInteger(snapshot.admittedFileCount) || snapshot.admittedFileCount < 0 || snapshot.admittedFileCount > 5_000 ||
      !Number.isInteger(snapshot.excludedEntryCount) || snapshot.excludedEntryCount < 0 || snapshot.excludedEntryCount > 50_000 ||
      !(snapshot.createdAt instanceof Date) || !Number.isFinite(snapshot.createdAt.getTime())) corrupt();
  let admitted = 0, excluded = 0, total = 0n;
  const manifestEntries: SnapshotEntry[] = [];
  const ids = new Set<string>(), paths = new Set<string>();
  for (let index = 0; index < snapshot.entries.length; index++) {
    const entry = snapshot.entries[index];
    if (!UUID.test(entry.id) || entry.manifestOrder !== index || ids.has(entry.id) || paths.has(entry.path) ||
        (index > 0 && compareUtf8(snapshot.entries[index - 1].path, entry.path) >= 0)) corrupt();
    ids.add(entry.id); paths.add(entry.path);
    if (!safeText(entry.path, 1, 4_096) || Buffer.byteLength(entry.path, "utf8") > 1_024 ||
        (entry.exclusionReason !== "unsafe_path" && !isUnambiguouslyNormalizedPath(entry.path)) || !["100644", "100755", "040000", "120000", "160000"].includes(entry.mode) ||
        !["blob", "tree", "commit"].includes(entry.objectType) || !SHA1.test(entry.objectSha) ||
        (entry.reportedSize !== null && (!/^\d+$/.test(entry.reportedSize) || BigInt(entry.reportedSize) > 9_223_372_036_854_775_807n))) corrupt();
    if (entry.decision === "excluded") {
      excluded++;
      if (entry.file !== null || !entry.exclusionReason || !EXCLUSION_REASONS.has(entry.exclusionReason as ExclusionReason)) corrupt();
    } else if (entry.decision === "admitted") {
      admitted++;
      if (entry.exclusionReason !== null || !entry.file || !["100644", "100755"].includes(entry.mode) || entry.objectType !== "blob") corrupt();
      const file = entry.file;
      if (!(file.rawContent instanceof Uint8Array) || !Number.isInteger(file.byteCount) || file.rawContent.byteLength !== file.byteCount || file.byteCount < 0 || file.byteCount > 1_048_576 ||
          !Number.isInteger(file.lineCount) || file.lineCount < 0 || file.lineCount > 100_000 || !SHA256.test(file.rawSha256) || !SHA256.test(file.normalizedSha256) ||
          hash(file.rawContent) !== file.rawSha256) corrupt();
      if (gitBlobSha1(file.rawContent) !== entry.objectSha) corrupt();
      let normalized: string;
      try { normalized = new TextDecoder("utf-8", { fatal: true }).decode(file.rawContent).replace(/\r\n?/g, "\n"); }
      catch { corrupt(); }
      if (normalized! !== file.normalizedText || TEXT_CONTROL.test(file.normalizedText) || secretPolicyEvaluator(snapshot.admissionPolicyVersion)(file.normalizedText) ||
          hash(new TextEncoder().encode(file.normalizedText)) !== file.normalizedSha256 || lines(file.normalizedText) !== file.lineCount ||
          (file.detectedLanguage !== null && !safeText(file.detectedLanguage, 1, 64))) corrupt();
      total += BigInt(file.byteCount);
    } else corrupt();
    manifestEntries.push({ path: entry.path, mode: entry.mode, type: entry.objectType, objectSha: entry.objectSha,
      reportedSize: entry.reportedSize, decision: entry.decision, exclusionReason: entry.exclusionReason as ExclusionReason | null,
      rawSha256: entry.file?.rawSha256 ?? null, normalizedSha256: entry.file?.normalizedSha256 ?? null,
      byteCount: entry.file?.byteCount ?? null, lineCount: entry.file?.lineCount ?? null });
  }
  if (snapshot.inspectedEntryCount !== snapshot.entries.length || snapshot.admittedFileCount !== admitted ||
      snapshot.excludedEntryCount !== excluded || fileRowCount !== admitted || snapshot.totalAdmittedBytes !== total.toString()) corrupt();
  const manifest = canonicalizeManifest({ githubRepositoryId: snapshot.githubRepositoryId, canonicalOwner: snapshot.canonicalOwner,
    canonicalRepository: snapshot.canonicalRepository, canonicalUrl: snapshot.canonicalUrl, defaultBranch: snapshot.defaultBranch,
    requestedRef: snapshot.requestedRef, resolvedRef: snapshot.resolvedRef, commitSha: snapshot.commitSha,
    rootTreeSha: snapshot.rootTreeSha, entries: manifestEntries });
  if (manifest.hash !== snapshot.manifestHashSha256) corrupt();
  return snapshot;
}

async function loadSnapshot(db: Kysely<Database> | Transaction<Database>, investigationId: string): Promise<PersistedRepositorySnapshot | null> {
  const snapshot = await db.selectFrom("repository_snapshots").selectAll().where("investigation_id", "=", investigationId).executeTakeFirst();
  if (!snapshot) return null;
  const rows = await db.selectFrom("repository_snapshot_entries")
    .select([
      "repository_snapshot_entries.id", "path", "mode", "object_type", "object_sha", "reported_size", "decision", "exclusion_reason", "manifest_order",
    ]).where("repository_snapshot_entries.snapshot_id", "=", snapshot.id).orderBy("manifest_order", "asc").limit(50_001).execute();
  const files = await db.selectFrom("repository_snapshot_files").select([
    "entry_id", "entry_decision", "raw_content", "normalized_text", "raw_sha256", "normalized_sha256",
    "byte_count", "line_count", "detected_language",
  ]).where("snapshot_id", "=", snapshot.id).limit(5_001).execute();
  const fileByEntry = new Map(files.map((file) => [file.entry_id, file]));
  const entryIds = new Set(rows.map((entry) => entry.id));
  if (fileByEntry.size !== files.length || files.some((file) => file.entry_decision !== "admitted" || !entryIds.has(file.entry_id))) corrupt();
  return validatePersistedSnapshot({
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
      file: (() => { const file = fileByEntry.get(row.id); return file ? {
        rawContent: file.raw_content, normalizedText: file.normalized_text, rawSha256: file.raw_sha256,
        normalizedSha256: file.normalized_sha256, byteCount: file.byte_count, lineCount: file.line_count,
        detectedLanguage: file.detected_language,
      } : null; })(),
    })),
  }, files.length);
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
            id: this.id(), snapshot_id: snapshotId, entry_id: entryRows[index].id, entry_decision: "admitted" as const,
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
      if (isSnapshotWinnerConflict(error)) {
        const winner = await this.findByInvestigation(investigationId);
        if (winner) return winner;
      }
      throw classifyDatabaseError(error);
    }
  }
}
