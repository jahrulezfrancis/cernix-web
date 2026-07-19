import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { canTransitionBackendLifecycle, type BackendLifecycleStatus } from "@/lib/contracts/investigation-api";
import type { CompletionDisposition } from "@/lib/contracts/judgment-report";
import type { Database, InvestigationJobsTable } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import { isReportComplete, loadPersistedReport } from "@/server/persistence/judgment-repository";
import { PublicInvestigationEventSchema } from "@/server/persistence/events";
import { readJudgeJobMaxAttempts } from "./judge-worker-config";

export type JudgeJobStatus = InvestigationJobsTable["status"];
export type JudgeJobClaim = Readonly<{
  jobId: string; investigationId: string; attemptNumber: number; attemptId: string;
  maxAttempts: number; leaseToken: string; leaseExpiresAt: Date;
}>;
export type ClaimResult =
  | Readonly<{ kind: "claimed"; claim: JudgeJobClaim }>
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "reconciled"; jobId: string; status: "succeeded" | "failed" | "cancelled" }>;
export type MutationResult =
  | Readonly<{ kind: "updated"; status: JudgeJobStatus }>
  | Readonly<{ kind: "already_terminal"; status: "succeeded" | "failed" | "cancelled" }>
  | Readonly<{ kind: "lease_lost" }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "lifecycle_conflict" }>;

type JobRow = {
  id: string; investigation_id: string; status: JudgeJobStatus; attempt_count: number;
  max_attempts: number; available_at: Date; lease_owner: string | null; lease_token: string | null;
  lease_expires_at: Date | null; last_heartbeat_at: Date | null; started_at: Date | null;
  completed_at: Date | null; failed_at: Date | null; failure_code: string | null;
  created_at: Date; updated_at: Date;
};
type Db = Kysely<Database> | Transaction<Database>;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const TERMINAL_SUCCESS = new Set<BackendLifecycleStatus>(["completed", "completed_with_limitations"]);

function terminal(status: JudgeJobStatus): status is "succeeded" | "failed" | "cancelled" {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
function validOwner(owner: string): void {
  if (!OWNER.test(owner)) throw new ApplicationError("malformed_input", {});
}
function validCode(code: string): void {
  if (!CODE.test(code)) throw new ApplicationError("malformed_input", {});
}
function validLeaseSeconds(value: number): void {
  if (!Number.isInteger(value) || value < 30 || value > 900) throw new ApplicationError("malformed_input", {});
}
function validDelaySeconds(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 3_600) throw new ApplicationError("malformed_input", {});
}
function requireOne(result: { numUpdatedRows: bigint }): void {
  if (result.numUpdatedRows !== 1n) throw new ApplicationError("internal_error", {});
}
async function databaseNow(tx: Db): Promise<Date> {
  return (await sql<{ now: Date }>`select transaction_timestamp() as now`.execute(tx)).rows[0].now;
}
async function appendTransition(tx: Transaction<Database>, investigationId: string, from: BackendLifecycleStatus,
  to: BackendLifecycleStatus, now: Date): Promise<void> {
  if (!canTransitionBackendLifecycle(from, to) || from === to) throw new ApplicationError("invalid_lifecycle_transition", {});
  const event = PublicInvestigationEventSchema.parse({ type: "lifecycle_transitioned", stage: to, payload: { from, to } });
  await tx.insertInto("investigation_events").values({ investigation_id: investigationId, type: event.type,
    stage: event.stage, public_payload: JSON.stringify(event.payload), created_at: now }).execute();
}
async function transitionInvestigation(tx: Transaction<Database>, row: { id: string; status: BackendLifecycleStatus; version: number;
  started_at: Date | null; completed_at: Date | null }, to: CompletionDisposition | "failed", now: Date, failureCode?: string) {
  if (row.status === to) return;
  if (!canTransitionBackendLifecycle(row.status, to)) throw new ApplicationError("invalid_lifecycle_transition", {});
  await tx.updateTable("investigations").set({
    status: to, version: sql`version + 1`, updated_at: now,
    started_at: row.started_at ?? now,
    completed_at: to === "failed" ? row.completed_at : now,
    failure_code: to === "failed" ? failureCode! : null,
  }).where("id", "=", row.id).execute();
  await appendTransition(tx, row.id, row.status, to, now);
}
async function finishExpiredAttempt(tx: Transaction<Database>, job: JobRow, now: Date): Promise<void> {
  if (job.status !== "leased" || !job.lease_token) return;
  requireOne(await tx.updateTable("judge_job_attempts").set({ status: "lease_expired", finished_at: now,
    failure_code: "lease_expired", next_available_at: null }).where("job_id", "=", job.id)
    .where("lease_token", "=", job.lease_token).where("status", "=", "leased").executeTakeFirst());
}
async function clearToTerminal(tx: Transaction<Database>, job: JobRow, status: "succeeded" | "failed" | "cancelled",
  code: string | null, now: Date): Promise<void> {
  await tx.updateTable("investigation_jobs").set({ status, lease_owner: null, lease_token: null,
    lease_expires_at: null, last_heartbeat_at: null, completed_at: status === "succeeded" || status === "cancelled" ? now : null,
    failed_at: status === "failed" ? now : null, failure_code: code,
    started_at: status === "succeeded" ? job.started_at ?? now : job.started_at, updated_at: now }).where("id", "=", job.id).execute();
}

export async function enqueueJudgeJob(tx: Transaction<Database>, investigationId: string, now: Date, uuid: () => string): Promise<void> {
  const active = await tx.selectFrom("investigation_jobs").select("id")
    .where("investigation_id", "=", investigationId).where("kind", "=", "investigation_judge")
    .where("status", "in", ["queued", "leased", "retry_wait", "succeeded"]).executeTakeFirst();
  if (active) return;
  await tx.insertInto("investigation_jobs").values({
    id: uuid(), investigation_id: investigationId, kind: "investigation_judge", status: "queued",
    max_attempts: readJudgeJobMaxAttempts(), available_at: now, lease_owner: null, lease_token: null,
    lease_expires_at: null, last_heartbeat_at: null, started_at: null, completed_at: null, failed_at: null,
    failure_code: null, created_at: now, updated_at: now,
  }).execute();
  const event = PublicInvestigationEventSchema.parse({
    type: "investigation_started", stage: "judging", payload: { jobKind: "investigation_judge" },
  });
  await tx.insertInto("investigation_events").values({
    investigation_id: investigationId, type: event.type, stage: event.stage,
    public_payload: JSON.stringify(event.payload), created_at: now,
  }).execute();
}

async function finalizeJudgeOutcome(tx: Transaction<Database>, investigation: { id: string; status: BackendLifecycleStatus;
  version: number; started_at: Date | null; completed_at: Date | null }, now: Date): Promise<void> {
  const report = await loadPersistedReport(tx, investigation.id);
  if (!report) throw new ApplicationError("conflict", {});
  await transitionInvestigation(tx, investigation, report.completionDisposition, now);
}

export class JudgeJobRepository {
  constructor(private readonly db: Kysely<Database>, private readonly uuid: () => string = randomUUID) {}

  async claimNext(options: { workerOwner: string; leaseSeconds: number }): Promise<ClaimResult> {
    validOwner(options.workerOwner); validLeaseSeconds(options.leaseSeconds);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const selected = (await sql<JobRow>`
          select id, investigation_id, status, attempt_count, max_attempts, available_at, lease_owner,
            lease_token, lease_expires_at, last_heartbeat_at, started_at, completed_at, failed_at,
            failure_code, created_at, updated_at
          from investigation_jobs
          where kind = 'investigation_judge' and (
            (status in ('queued','retry_wait') and available_at <= transaction_timestamp()) or
            (status = 'leased' and lease_expires_at <= transaction_timestamp())
          )
          order by available_at asc, created_at asc, id asc
          for update skip locked limit 1
        `.execute(tx)).rows[0];
        if (!selected) return { kind: "idle" };
        const now = await databaseNow(tx);
        const investigation = await tx.selectFrom("investigations")
          .select(["id", "status", "version", "started_at", "completed_at"])
          .where("id", "=", selected.investigation_id).forUpdate().executeTakeFirst();
        if (!investigation) return { kind: "reconciled", jobId: selected.id, status: "cancelled" };
        await finishExpiredAttempt(tx, selected, now);
        const reportComplete = await isReportComplete(tx, selected.investigation_id);

        if (investigation.status === "failed" || TERMINAL_SUCCESS.has(investigation.status)) {
          await clearToTerminal(tx, selected, "cancelled", investigation.status === "failed" ? "investigation_failed" : "investigation_terminal", now);
          return { kind: "reconciled", jobId: selected.id, status: "cancelled" };
        }
        if (investigation.status !== "judging") {
          await clearToTerminal(tx, selected, "cancelled", "judge_unexpected_state", now);
          return { kind: "reconciled", jobId: selected.id, status: "cancelled" };
        }
        if (reportComplete) {
          await finalizeJudgeOutcome(tx, investigation, now);
          await clearToTerminal(tx, selected, "succeeded", null, now);
          return { kind: "reconciled", jobId: selected.id, status: "succeeded" };
        }
        if (selected.attempt_count >= selected.max_attempts) {
          await transitionInvestigation(tx, investigation, "failed", now, "attempts_exhausted");
          await clearToTerminal(tx, selected, "failed", "attempts_exhausted", now);
          return { kind: "reconciled", jobId: selected.id, status: "failed" };
        }

        const leaseToken = this.uuid(), attemptNumber = selected.attempt_count + 1;
        const updated = await tx.updateTable("investigation_jobs").set({ status: "leased", attempt_count: attemptNumber,
          lease_owner: options.workerOwner, lease_token: leaseToken, last_heartbeat_at: now,
          lease_expires_at: sql`transaction_timestamp() + make_interval(secs => ${options.leaseSeconds})`,
          started_at: selected.started_at ?? now, completed_at: null, failed_at: null, failure_code: null,
          updated_at: now }).where("id", "=", selected.id).returning("lease_expires_at").executeTakeFirstOrThrow();
        const attempt = await tx.insertInto("judge_job_attempts").values({ job_id: selected.id,
          investigation_id: selected.investigation_id, attempt_number: attemptNumber, lease_token: leaseToken,
          worker_owner: options.workerOwner, status: "leased", started_at: now, last_heartbeat_at: now,
          finished_at: null, failure_code: null, next_available_at: null }).returning("id").executeTakeFirstOrThrow();
        return { kind: "claimed", claim: { jobId: selected.id, investigationId: selected.investigation_id,
          attemptNumber, attemptId: String(attempt.id), maxAttempts: selected.max_attempts, leaseToken,
          leaseExpiresAt: updated.lease_expires_at! } };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<MutationResult> {
    validLeaseSeconds(leaseSeconds);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const now = await databaseNow(tx);
        const updated = await tx.updateTable("investigation_jobs").set({ last_heartbeat_at: now,
          lease_expires_at: sql`transaction_timestamp() + make_interval(secs => ${leaseSeconds})`, updated_at: now })
          .where("id", "=", jobId).where("status", "=", "leased").where("lease_token", "=", leaseToken)
          .where("lease_expires_at", ">", now).returning("id").executeTakeFirst();
        if (!updated) return this.missedMutation(tx, jobId);
        requireOne(await tx.updateTable("judge_job_attempts").set({ last_heartbeat_at: now }).where("job_id", "=", jobId)
          .where("lease_token", "=", leaseToken).where("status", "=", "leased").executeTakeFirst());
        return { kind: "updated", status: "leased" };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async completeSuccess(jobId: string, leaseToken: string): Promise<MutationResult> {
    try {
      return await this.db.transaction().execute(async (tx) => {
        const locked = await this.lockedJob(tx, jobId);
        if (!locked) return { kind: "not_found" };
        if (locked.status === "succeeded") {
          const investigation = await tx.selectFrom("investigations").select("status")
            .where("id", "=", locked.investigation_id).forUpdate().executeTakeFirst();
          if (!investigation || investigation.status === "judging" ||
              !await isReportComplete(tx, locked.investigation_id)) return { kind: "lifecycle_conflict" };
          return { kind: "already_terminal", status: "succeeded" };
        }
        if (locked.status === "failed" || locked.status === "cancelled") return { kind: "already_terminal", status: locked.status };
        const now = await databaseNow(tx);
        if (!this.ownsLiveLease(locked, leaseToken, now)) return { kind: "lease_lost" };
        const investigation = await tx.selectFrom("investigations")
          .select(["id", "status", "version", "started_at", "completed_at"])
          .where("id", "=", locked.investigation_id).forUpdate().executeTakeFirst();
        if (!investigation) return { kind: "not_found" };
        if (investigation.status !== "judging" || !await isReportComplete(tx, locked.investigation_id)) {
          return { kind: "lifecycle_conflict" };
        }
        await finalizeJudgeOutcome(tx, investigation, now);
        requireOne(await tx.updateTable("judge_job_attempts").set({ status: "succeeded", finished_at: now })
          .where("job_id", "=", jobId).where("lease_token", "=", leaseToken).where("status", "=", "leased").executeTakeFirst());
        await clearToTerminal(tx, locked, "succeeded", null, now);
        return { kind: "updated", status: "succeeded" };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async scheduleRetry(jobId: string, leaseToken: string, failureCode: string, delaySeconds: number): Promise<MutationResult> {
    validCode(failureCode); validDelaySeconds(delaySeconds);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const locked = await this.lockedJob(tx, jobId);
        if (!locked) return { kind: "not_found" };
        if (terminal(locked.status)) return { kind: "already_terminal", status: locked.status };
        const now = await databaseNow(tx);
        if (!this.ownsLiveLease(locked, leaseToken, now)) return { kind: "lease_lost" };
        if (locked.attempt_count >= locked.max_attempts) return { kind: "lifecycle_conflict" };
        const next = (await sql<{ next: Date }>`select transaction_timestamp() + make_interval(secs => ${delaySeconds}) as next`.execute(tx)).rows[0].next;
        requireOne(await tx.updateTable("judge_job_attempts").set({ status: "retry_scheduled", finished_at: now,
          failure_code: failureCode, next_available_at: next }).where("job_id", "=", jobId)
          .where("lease_token", "=", leaseToken).where("status", "=", "leased").executeTakeFirst());
        await tx.updateTable("investigation_jobs").set({ status: "retry_wait", available_at: next,
          lease_owner: null, lease_token: null, lease_expires_at: null, last_heartbeat_at: null,
          failure_code: failureCode, updated_at: now }).where("id", "=", jobId).execute();
        return { kind: "updated", status: "retry_wait" };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async completeFailure(jobId: string, leaseToken: string, failureCode: string): Promise<MutationResult> {
    validCode(failureCode);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const locked = await this.lockedJob(tx, jobId);
        if (!locked) return { kind: "not_found" };
        if (terminal(locked.status)) return { kind: "already_terminal", status: locked.status };
        const now = await databaseNow(tx);
        if (!this.ownsLiveLease(locked, leaseToken, now)) return { kind: "lease_lost" };
        const investigation = await tx.selectFrom("investigations").select(["id", "status", "version", "started_at", "completed_at"])
          .where("id", "=", locked.investigation_id).forUpdate().executeTakeFirst();
        if (!investigation) return { kind: "not_found" };
        if (investigation.status === "judging") await transitionInvestigation(tx, investigation, "failed", now, failureCode);
        else if (investigation.status !== "failed") return { kind: "lifecycle_conflict" };
        requireOne(await tx.updateTable("judge_job_attempts").set({ status: "failed", finished_at: now, failure_code: failureCode })
          .where("job_id", "=", jobId).where("lease_token", "=", leaseToken).where("status", "=", "leased").executeTakeFirst());
        await clearToTerminal(tx, locked, "failed", failureCode, now);
        return { kind: "updated", status: "failed" };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async getJob(jobId: string) {
    try {
      const row = await this.db.selectFrom("investigation_jobs").selectAll().where("id", "=", jobId).executeTakeFirst();
      return row ? { id: row.id, investigationId: row.investigation_id, status: row.status,
        attemptCount: row.attempt_count, maxAttempts: row.max_attempts, availableAt: row.available_at,
        leaseExpiresAt: row.lease_expires_at, failureCode: row.failure_code } : null;
    } catch (error) { throw classifyDatabaseError(error); }
  }

  private async lockedJob(tx: Transaction<Database>, id: string): Promise<JobRow | undefined> {
    return await tx.selectFrom("investigation_jobs").selectAll().where("id", "=", id).forUpdate().executeTakeFirst() as JobRow | undefined;
  }
  private ownsLiveLease(job: JobRow, token: string, now: Date): boolean {
    return job.status === "leased" && job.lease_token === token && Boolean(job.lease_expires_at && job.lease_expires_at > now);
  }
  private async missedMutation(tx: Transaction<Database>, jobId: string): Promise<MutationResult> {
    const row = await tx.selectFrom("investigation_jobs").select("status").where("id", "=", jobId).executeTakeFirst();
    if (!row) return { kind: "not_found" };
    return terminal(row.status) ? { kind: "already_terminal", status: row.status } : { kind: "lease_lost" };
  }
}
