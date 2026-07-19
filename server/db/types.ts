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
  status: "queued";
  attempt: Generated<number>;
  available_at: Timestamp;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface Database {
  investigations: InvestigationsTable;
  manual_claims: ManualClaimsTable;
  investigation_events: InvestigationEventsTable;
  idempotency_records: IdempotencyRecordsTable;
  investigation_jobs: InvestigationJobsTable;
}
