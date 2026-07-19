import type { ColumnType, Generated } from "kysely";
import type { BackendLifecycleStatus } from "@/lib/contracts/investigation-api";

type Timestamp = ColumnType<Date, Date, Date>;

export interface InvestigationsTable {
  id: string;
  status: BackendLifecycleStatus;
  repository_owner: string;
  repository_name: string;
  repository_canonical_url: string;
  requested_ref: string | null;
  version: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  failure_code: string | null;
}
export interface ManualClaimsTable {
  id: string;
  investigation_id: string;
  statement: string;
  preserved_qualifiers: ColumnType<string[], string, string>;
  approved_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface InvestigationEventsTable {
  sequence: Generated<string>;
  investigation_id: string;
  type: string;
  stage: BackendLifecycleStatus;
  public_payload: ColumnType<
    Record<string, string | number | boolean | null>,
    string,
    string
  >;
  created_at: Timestamp;
}
export interface IdempotencyRecordsTable {
  scope: string;
  idempotency_key: string;
  request_hash_sha256: string;
  investigation_id: string;
  result_kind: string;
  created_at: Timestamp;
}
export interface InvestigationJobsTable {
  id: string;
  investigation_id: string;
  kind: "repository_snapshot";
  status: "queued" | "leased" | "retry_wait" | "succeeded" | "failed" | "cancelled";
  attempt_count: Generated<number>;
  max_attempts: Generated<number>;
  available_at: Timestamp;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Timestamp | null;
  last_heartbeat_at: Timestamp | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  failed_at: Timestamp | null;
  failure_code: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface SnapshotJobAttemptsTable {
  id: Generated<string>;
  job_id: string;
  investigation_id: string;
  attempt_number: number;
  lease_token: string;
  worker_owner: string;
  status: "leased" | "succeeded" | "retry_scheduled" | "failed" | "lease_expired" | "cancelled";
  started_at: Timestamp;
  last_heartbeat_at: Timestamp;
  finished_at: Timestamp | null;
  failure_code: string | null;
  next_available_at: Timestamp | null;
}
export interface RepositorySnapshotsTable {
  id: string; investigation_id: string; github_repository_id: string;
  canonical_owner: string; canonical_repository: string; canonical_url: string;
  default_branch: string; requested_ref: string | null; resolved_ref: string;
  commit_sha: string; root_tree_sha: string; manifest_schema_version: number;
  admission_policy_version: number; manifest_hash_sha256: string;
  inspected_entry_count: number; admitted_file_count: number; excluded_entry_count: number;
  total_admitted_bytes: string; created_at: Timestamp;
}
export interface RepositorySnapshotEntriesTable {
  id: string; snapshot_id: string; path: string; mode: string; object_type: string;
  object_sha: string; reported_size: string | null; decision: "admitted" | "excluded";
  exclusion_reason: string | null; manifest_order: number;
}
export interface RepositorySnapshotFilesTable {
  id: string; snapshot_id: string; entry_id: string; entry_decision: "admitted"; raw_content: Uint8Array;
  normalized_text: string; raw_sha256: string; normalized_sha256: string;
  byte_count: number; line_count: number; detected_language: string | null; created_at: Timestamp;
}
export interface Database {
  investigations: InvestigationsTable;
  manual_claims: ManualClaimsTable;
  investigation_events: InvestigationEventsTable;
  idempotency_records: IdempotencyRecordsTable;
  investigation_jobs: InvestigationJobsTable;
  snapshot_job_attempts: SnapshotJobAttemptsTable;
  repository_snapshots: RepositorySnapshotsTable;
  repository_snapshot_entries: RepositorySnapshotEntriesTable;
  repository_snapshot_files: RepositorySnapshotFilesTable;
}
