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
  reinvestigation_cycle_count: Generated<number>;
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
  kind: "repository_snapshot" | "investigation_planning" | "investigation_evidence" | "investigation_skeptic" | "investigation_judge";
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
export interface PlanningJobAttemptsTable {
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
export interface InvestigationPlansTable {
  id: string;
  investigation_id: string;
  snapshot_id: string;
  manifest_hash_sha256: string;
  commit_sha: string;
  schema_version: number;
  model_id: string;
  prompt_version: string;
  canonical_plan: ColumnType<Record<string, unknown>, string, string>;
  obligation_count: number;
  task_count: number;
  created_at: Timestamp;
}
export interface VerificationObligationsTable {
  id: string;
  plan_id: string;
  claim_id: string;
  obligation_key: string;
  description: string;
  taxonomy: string | null;
  priority: number;
}
export interface EvidenceTasksTable {
  id: string;
  plan_id: string;
  claim_id: string;
  task_key: string;
  specialist_capability: string;
  expected_evidence_types: ColumnType<string[], string, string>;
  query_terms: ColumnType<string[], string, string>;
  priority: number;
  depends_on_task_ids: ColumnType<string[], string, string>;
}
export interface EvidenceTaskObligationsTable {
  task_id: string;
  obligation_id: string;
}
export interface ModelInvocationsTable {
  id: Generated<string>;
  plan_id: string | null;
  attempt_id: string | null;
  model_id: string;
  prompt_version: string;
  input_token_estimate: number | null;
  output_token_estimate: number | null;
  status: "succeeded" | "failed";
  failure_code: string | null;
  created_at: Timestamp;
}
export interface EvidenceJobAttemptsTable {
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
export interface EvidenceTaskRunsTable {
  id: string;
  task_id: string;
  plan_id: string;
  investigation_id: string;
  claim_id: string;
  task_key: string;
  specialist_capability: string;
  status: "queued" | "succeeded" | "failed" | "skipped_deferred";
  failure_code: string | null;
  canonical_result: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  created_at: Timestamp;
  finished_at: Timestamp | null;
}
export interface EvidenceCandidatesTable {
  id: string;
  run_id: string;
  investigation_id: string;
  claim_id: string;
  snapshot_id: string;
  candidate_key: string;
  evidence_type: string;
  observation: string;
  strength: "weak" | "moderate" | "strong";
  manifest_hash_sha256: string;
  commit_sha: string;
  created_at: Timestamp;
}
export interface EvidenceExcerptsTable {
  id: string;
  candidate_id: string;
  path: string;
  line_start: number;
  line_end: number;
  normalized_sha256: string;
  excerpt_text: string;
}
export interface EvidenceGapsTable {
  id: string;
  run_id: string;
  gap_key: string;
  description: string;
  impact: "low" | "medium" | "high";
}
export interface CounterevidenceItemsTable {
  id: string;
  run_id: string;
  counter_key: string;
  related_candidate_key: string | null;
  description: string;
  severity: "minor" | "material" | "critical";
}
export interface SkepticJobAttemptsTable {
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
export interface SkepticAnalysesTable {
  id: string;
  investigation_id: string;
  plan_id: string;
  snapshot_id: string;
  claim_id: string;
  manifest_hash_sha256: string;
  commit_sha: string;
  schema_version: number;
  model_id: string;
  prompt_version: string;
  outcome: "cleared_for_judgment" | "reinvestigation_required";
  reinvestigation_cycle: number;
  challenge_count: number;
  canonical_artifact: ColumnType<Record<string, unknown>, string, string>;
  created_at: Timestamp;
}
export interface SkepticChallengesTable {
  id: string;
  analysis_id: string;
  investigation_id: string;
  claim_id: string;
  challenge_key: string;
  challenge_type: string;
  severity: "critical" | "major" | "minor";
  summary: string;
  reasoning: string;
  evidence_refs: ColumnType<unknown[], string, string>;
  related_candidate_keys: ColumnType<string[], string, string>;
  requested_reinvestigation: boolean;
  created_at: Timestamp;
}
export interface ChallengeResolutionsTable {
  id: string;
  challenge_id: string;
  disposition: "accepted" | "deferred_to_judge" | "triggers_reinvestigation";
  resolution_note: string;
  created_at: Timestamp;
}
export interface JudgeJobAttemptsTable {
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
export interface InvestigationReportsTable {
  id: string;
  investigation_id: string;
  plan_id: string;
  snapshot_id: string;
  skeptic_analysis_id: string;
  claim_id: string;
  manifest_hash_sha256: string;
  commit_sha: string;
  schema_version: number;
  model_id: string;
  prompt_version: string;
  completion_disposition: "completed" | "completed_with_limitations";
  report_summary: string;
  artifact_hash_sha256: string;
  canonical_artifact: ColumnType<Record<string, unknown>, string, string>;
  judgment_count: number;
  created_at: Timestamp;
}
export interface ClaimJudgmentsTable {
  id: string;
  report_id: string;
  investigation_id: string;
  claim_id: string;
  judgment_key: string;
  verdict: "verified" | "partially_verified" | "unverified";
  confidence: "high" | "moderate" | "low";
  summary: string;
  reasoning: string;
  confidence_factors: ColumnType<string[], string, string>;
  unproven_aspects: ColumnType<string[], string, string>;
  what_could_change_verdict: ColumnType<string[], string, string>;
  created_at: Timestamp;
}
export interface ReportLimitationsTable {
  id: string;
  report_id: string;
  investigation_id: string;
  claim_id: string;
  limitation_key: string;
  description: string;
  impact: "low" | "medium" | "high";
  created_at: Timestamp;
}
export interface MaintainerActionsTable {
  id: string;
  report_id: string;
  investigation_id: string;
  claim_id: string;
  action_key: string;
  action_text: string;
  priority: "low" | "medium" | "high";
  created_at: Timestamp;
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
  planning_job_attempts: PlanningJobAttemptsTable;
  evidence_job_attempts: EvidenceJobAttemptsTable;
  evidence_task_runs: EvidenceTaskRunsTable;
  evidence_candidates: EvidenceCandidatesTable;
  evidence_excerpts: EvidenceExcerptsTable;
  evidence_gaps: EvidenceGapsTable;
  counterevidence_items: CounterevidenceItemsTable;
  skeptic_job_attempts: SkepticJobAttemptsTable;
  skeptic_analyses: SkepticAnalysesTable;
  skeptic_challenges: SkepticChallengesTable;
  challenge_resolutions: ChallengeResolutionsTable;
  judge_job_attempts: JudgeJobAttemptsTable;
  investigation_reports: InvestigationReportsTable;
  claim_judgments: ClaimJudgmentsTable;
  report_limitations: ReportLimitationsTable;
  maintainer_actions: MaintainerActionsTable;
  investigation_plans: InvestigationPlansTable;
  verification_obligations: VerificationObligationsTable;
  evidence_tasks: EvidenceTasksTable;
  evidence_task_obligations: EvidenceTaskObligationsTable;
  model_invocations: ModelInvocationsTable;
  repository_snapshots: RepositorySnapshotsTable;
  repository_snapshot_entries: RepositorySnapshotEntriesTable;
  repository_snapshot_files: RepositorySnapshotFilesTable;
}
