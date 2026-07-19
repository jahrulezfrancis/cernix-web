import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "@/server/db/types";
import { createDisposableTestDatabase } from "@/server/db/test-database";
import { migrateToLatest, rollbackOne } from "@/server/db/migrate";
import { InvestigationRepository } from "@/server/persistence/investigation-repository";
import { RepositorySnapshotRepository } from "@/server/persistence/repository-snapshot-repository";
import { finalizeArtifact } from "@/server/github/manifest";
import type { SnapshotEntry } from "@/server/github/contracts";
import { RepositorySnapshotService } from "@/server/github/snapshot-service";
import { SnapshotJobRepository } from "./snapshot-job-repository";
import { SnapshotWorker } from "./snapshot-worker";

let harness: Awaited<ReturnType<typeof createDisposableTestDatabase>>;
let db: Kysely<Database>, investigations: InvestigationRepository, jobs: SnapshotJobRepository;
const input = { repositoryUrl: "https://github.com/Acme/Widget", claim: { statement: "A safe claim." } };
const approval = { statement: "A safe claim.", preservedQualifiers: [], approved: true as const };

async function truncate() {
  await sql`truncate snapshot_job_attempts, repository_snapshot_files, repository_snapshot_entries,
    repository_snapshots, investigation_jobs, idempotency_records, investigation_events,
    manual_claims, investigations restart identity cascade`.execute(db);
}
async function started() {
  const created = await investigations.createInvestigation(input, randomUUID());
  await investigations.approveClaim(created.id, approval);
  const investigation = await investigations.startInvestigation(created.id, randomUUID());
  const job = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id).executeTakeFirstOrThrow();
  return { investigation, job };
}
function artifact() {
  const raw = Buffer.from("hello\n"), normalized = "hello\n";
  const entry: SnapshotEntry = { path: "README.md", mode: "100644", type: "blob",
    objectSha: "ce013625030ba8dba906f756967f9e9ca394464a", reportedSize: String(raw.byteLength),
    decision: "admitted", exclusionReason: null, rawSha256: createHash("sha256").update(raw).digest("hex"),
    normalizedSha256: createHash("sha256").update(normalized).digest("hex"), byteCount: raw.byteLength,
    lineCount: 1, rawContent: raw, normalizedText: normalized, detectedLanguage: "Markdown" };
  return finalizeArtifact({ githubRepositoryId: "9007199254740991", canonicalOwner: "Acme",
    canonicalRepository: "Widget", canonicalUrl: "https://github.com/Acme/Widget", defaultBranch: "main",
    requestedRef: null, resolvedRef: "main", commitSha: "a".repeat(40), rootTreeSha: "b".repeat(40), entries: [entry] });
}
async function rejectSql(action: (tx: Transaction<Database>) => Promise<unknown>) {
  await expect(db.transaction().execute(action)).rejects.toBeTruthy();
}

beforeAll(async () => {
  harness = await createDisposableTestDatabase(); db = harness.db;
  investigations = new InvestigationRepository(db); jobs = new SnapshotJobRepository(db);
  await migrateToLatest(db);
});
beforeEach(truncate);
afterAll(async () => { await harness?.cleanup(); });

describe.sequential("durable snapshot job orchestration", () => {
  it("migrates populated queued jobs down and up while preserving claimability", async () => {
    const { job } = await started();
    await rollbackOne(db);
    await rollbackOne(db);
    await rollbackOne(db);
    await rollbackOne(db);
    const legacy = (await sql<{ id: string; attempt: number; status: string }>`select id, attempt, status from investigation_jobs where id=${job.id}`.execute(db)).rows[0];
    expect(legacy).toEqual({ id: job.id, attempt: 0, status: "queued" });
    await sql`alter table investigation_jobs rename constraint investigation_jobs_queued_lease_check to investigation_jobs_check`.execute(db);
    await migrateToLatest(db);
    const migrated = await jobs.getJob(job.id);
    expect(migrated).toMatchObject({ id: job.id, status: "queued", attemptCount: 0, maxAttempts: 4 });
    await expect(jobs.claimNext({ workerOwner: "worker-migration", leaseSeconds: 30 })).resolves.toMatchObject({ kind: "claimed" });
  });

  it("copies the configured attempt budget into each newly queued job", async () => {
    const configured = new InvestigationRepository(db, () => new Date(), 2);
    const created = await configured.createInvestigation(input, randomUUID());
    await configured.approveClaim(created.id, approval);
    await configured.startInvestigation(created.id, randomUUID());
    expect(await db.selectFrom("investigation_jobs").select("max_attempts").where("investigation_id", "=", created.id).executeTakeFirstOrThrow())
      .toEqual({ max_attempts: 2 });
  });

  it("installs the exact worker columns, named checks, indexes, identity, uniques, and cascading ownership", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string; is_identity: string }>`
      select table_name,column_name,data_type,is_nullable,coalesce(column_default,'') column_default,is_identity
      from information_schema.columns where table_schema='public' and table_name in ('investigation_jobs','snapshot_job_attempts')
      order by table_name,ordinal_position`.execute(db);
    expect(columns.rows.find((row) => row.table_name === "snapshot_job_attempts" && row.column_name === "id"))
      .toMatchObject({ data_type: "bigint", is_identity: "YES" });
    expect(columns.rows.filter((row) => row.table_name === "investigation_jobs").map((row) => row.column_name)).toEqual([
      "id", "investigation_id", "kind", "status", "attempt_count", "available_at", "lease_owner",
      "lease_expires_at", "created_at", "updated_at", "max_attempts", "lease_token", "last_heartbeat_at",
      "started_at", "completed_at", "failed_at", "failure_code",
    ]);
    const checks = await sql<{ relname: string; conname: string }>`select c.relname,con.conname from pg_constraint con
      join pg_class c on c.oid=con.conrelid where con.contype='c' and c.relname in ('investigation_jobs','snapshot_job_attempts') order by con.conname`.execute(db);
    expect(checks.rows.map((row) => row.conname)).toEqual([
      "investigation_jobs_attempt_count_check", "investigation_jobs_failure_code_check", "investigation_jobs_kind_check",
      "investigation_jobs_lease_owner_check", "investigation_jobs_max_attempts_check", "investigation_jobs_state_coherence_check",
      "investigation_jobs_status_check", "investigation_jobs_timestamp_check", "snapshot_job_attempts_failure_code_check",
      "snapshot_job_attempts_number_check", "snapshot_job_attempts_state_coherence_check", "snapshot_job_attempts_status_check",
      "snapshot_job_attempts_timestamp_check", "snapshot_job_attempts_worker_owner_check",
    ]);
    const indexes = await sql<{ indexname: string; indexdef: string }>`select indexname,indexdef from pg_indexes where schemaname='public'
      and indexname in ('investigation_jobs_active_snapshot_idx','investigation_jobs_claim_idx','snapshot_job_attempts_job_idx') order by indexname`.execute(db);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "investigation_jobs_active_snapshot_idx", "investigation_jobs_claim_idx", "snapshot_job_attempts_job_idx",
    ]);
    const foreignKeys = await sql<{ conname: string; delete_action: string }>`select con.conname,
      case con.confdeltype when 'c' then 'CASCADE' else con.confdeltype::text end delete_action
      from pg_constraint con join pg_class c on c.oid=con.conrelid where c.relname='snapshot_job_attempts' and con.contype='f' order by con.conname`.execute(db);
    expect(foreignKeys.rows).toEqual([
      { conname: "snapshot_job_attempts_investigation_fk", delete_action: "CASCADE" },
      { conname: "snapshot_job_attempts_job_fk", delete_action: "CASCADE" },
    ]);
    const triggers = await sql<{ tgname: string }>`select tgname from pg_trigger where not tgisinternal
      and tgname in ('investigation_jobs_terminal_state_guard','snapshot_job_attempts_terminal_state_guard') order by tgname`.execute(db);
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      "investigation_jobs_terminal_state_guard", "snapshot_job_attempts_terminal_state_guard",
    ]);
  });

  it("rejects invalid job and attempt state combinations directly", async () => {
    const { job } = await started(), now = new Date(), token = randomUUID();
    for (const statement of [
      sql`update investigation_jobs set attempt_count=-1 where id=${job.id}`,
      sql`update investigation_jobs set max_attempts=11 where id=${job.id}`,
      sql`update investigation_jobs set attempt_count=5,max_attempts=4 where id=${job.id}`,
      sql`update investigation_jobs set status='leased',attempt_count=1,started_at=${now} where id=${job.id}`,
      sql`update investigation_jobs set lease_owner='unsafe owner' where id=${job.id}`,
      sql`update investigation_jobs set failure_code='UNSAFE' where id=${job.id}`,
      sql`update investigation_jobs set status='succeeded',started_at=${now},completed_at=${now},lease_owner='worker',lease_token=${token},lease_expires_at=${now},last_heartbeat_at=${now} where id=${job.id}`,
    ]) await rejectSql((tx) => statement.execute(tx));
    const claim = await jobs.claimNext({ workerOwner: "worker-valid", leaseSeconds: 30 });
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") return;
    await rejectSql((tx) => sql`insert into snapshot_job_attempts(job_id,investigation_id,attempt_number,lease_token,worker_owner,status,started_at,last_heartbeat_at)
      values (${job.id},${job.investigation_id},2,${randomUUID()},'worker','failed',${now},${now})`.execute(tx));
    await rejectSql((tx) => sql`insert into snapshot_job_attempts(job_id,investigation_id,attempt_number,lease_token,worker_owner,status,started_at,last_heartbeat_at)
      values (${job.id},${job.investigation_id},2,${claim.claim.leaseToken},'worker','leased',${now},${now})`.execute(tx));
    await rejectSql((tx) => sql`insert into snapshot_job_attempts(job_id,investigation_id,attempt_number,lease_token,worker_owner,status,started_at,last_heartbeat_at)
      values (${job.id},${job.investigation_id},1,${randomUUID()},'worker','leased',${now},${now})`.execute(tx));
    const other = await started();
    await rejectSql((tx) => sql`insert into snapshot_job_attempts(job_id,investigation_id,attempt_number,lease_token,worker_owner,status,started_at,last_heartbeat_at)
      values (${job.id},${other.investigation.id},2,${randomUUID()},'worker','leased',${now},${now})`.execute(tx));
    await rejectSql((tx) => sql`insert into investigation_jobs(id,investigation_id,kind,status,attempt_count,max_attempts,available_at,created_at,updated_at)
      values (${randomUUID()},${job.investigation_id},'repository_snapshot','queued',0,4,${now},${now},${now})`.execute(tx));
  });

  it("uses skip-locked claims exactly once under races and orders eligible jobs deterministically", async () => {
    const first = await started(), second = await started(), third = await started();
    const early = new Date(Date.now() - 3_000), late = new Date(Date.now() - 2_000), latest = new Date(Date.now() - 1_000);
    await db.updateTable("investigation_jobs").set({ created_at: early, available_at: early, updated_at: new Date() }).where("id", "=", first.job.id).execute();
    await db.updateTable("investigation_jobs").set({ created_at: late, available_at: late, updated_at: new Date() }).where("id", "=", second.job.id).execute();
    await db.updateTable("investigation_jobs").set({ created_at: latest, available_at: latest, updated_at: new Date() }).where("id", "=", third.job.id).execute();
    const ordered = await new SnapshotJobRepository(db).claimNext({ workerOwner: "worker-order", leaseSeconds: 30 });
    expect(ordered).toMatchObject({ kind: "claimed", claim: { jobId: first.job.id } });
    const [a, b] = await Promise.all([
      new SnapshotJobRepository(db).claimNext({ workerOwner: "worker-a", leaseSeconds: 30 }),
      new SnapshotJobRepository(db).claimNext({ workerOwner: "worker-b", leaseSeconds: 30 }),
    ]);
    expect([a, b].every((value) => value.kind === "claimed")).toBe(true);
    expect(new Set([a.kind === "claimed" ? a.claim.jobId : "", b.kind === "claimed" ? b.claim.jobId : ""])).toEqual(new Set([second.job.id, third.job.id]));
    const attempts = await db.selectFrom("snapshot_job_attempts").selectAll().orderBy("started_at").execute();
    expect(attempts).toHaveLength(3);

    await truncate();
    const one = await started();
    const raced = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      new SnapshotJobRepository(db).claimNext({ workerOwner: `worker-${index}`, leaseSeconds: 30 })));
    expect(raced.filter((value) => value.kind === "claimed")).toHaveLength(1);
    expect(raced.filter((value) => value.kind === "idle")).toHaveLength(9);
    expect(await db.selectFrom("snapshot_job_attempts").selectAll().where("job_id", "=", one.job.id).execute()).toHaveLength(1);
  });

  it("persists retry delay, heartbeat extension, expiry recovery, and stale-token fencing", async () => {
    const { job } = await started();
    const first = await jobs.claimNext({ workerOwner: "worker-first", leaseSeconds: 30 });
    expect(first.kind).toBe("claimed"); if (first.kind !== "claimed") return;
    const originalExpiry = first.claim.leaseExpiresAt;
    await expect(jobs.heartbeat(job.id, first.claim.leaseToken, 60)).resolves.toMatchObject({ kind: "updated" });
    expect((await jobs.getJob(job.id))!.leaseExpiresAt!.getTime()).toBeGreaterThan(originalExpiry.getTime());
    await expect(jobs.scheduleRetry(job.id, first.claim.leaseToken, "github_unavailable", 60)).resolves.toMatchObject({ kind: "updated", status: "retry_wait" });
    await expect(jobs.claimNext({ workerOwner: "worker-early", leaseSeconds: 30 })).resolves.toEqual({ kind: "idle" });
    await sql`update investigation_jobs set available_at=transaction_timestamp() where id=${job.id}`.execute(db);
    const second = await jobs.claimNext({ workerOwner: "worker-second", leaseSeconds: 30 });
    expect(second).toMatchObject({ kind: "claimed", claim: { attemptNumber: 2 } });
    if (second.kind !== "claimed") return;
    await sql`update investigation_jobs set created_at=transaction_timestamp()-interval '3 seconds',
      started_at=transaction_timestamp()-interval '2 seconds',last_heartbeat_at=transaction_timestamp()-interval '2 seconds',
      lease_expires_at=transaction_timestamp()-interval '1 second',updated_at=transaction_timestamp() where id=${job.id}`.execute(db);
    expect(await jobs.heartbeat(job.id, second.claim.leaseToken, 30)).toEqual({ kind: "lease_lost" });
    const replacement = await jobs.claimNext({ workerOwner: "worker-replacement", leaseSeconds: 30 });
    expect(replacement).toMatchObject({ kind: "claimed", claim: { attemptNumber: 3 } });
    if (replacement.kind !== "claimed") return;
    expect(await jobs.heartbeat(job.id, second.claim.leaseToken, 30)).toEqual({ kind: "lease_lost" });
    expect(await jobs.completeSuccess(job.id, second.claim.leaseToken)).toEqual({ kind: "lease_lost" });
    expect(await jobs.scheduleRetry(job.id, second.claim.leaseToken, "github_unavailable", 5)).toEqual({ kind: "lease_lost" });
    expect(await jobs.completeFailure(job.id, second.claim.leaseToken, "internal_error")).toEqual({ kind: "lease_lost" });
    await new RepositorySnapshotRepository(db).createForInvestigation(job.investigation_id, artifact());
    expect(await jobs.completeSuccess(job.id, replacement.claim.leaseToken)).toEqual({ kind: "updated", status: "succeeded" });
    const history = await db.selectFrom("snapshot_job_attempts").select(["attempt_number", "status"]).where("job_id", "=", job.id).orderBy("attempt_number").execute();
    expect(history).toEqual([{ attempt_number: 1, status: "retry_scheduled" }, { attempt_number: 2, status: "lease_expired" }, { attempt_number: 3, status: "succeeded" }]);
  });

  it("atomically succeeds with one planning event and supports idempotent terminal replay", async () => {
    const { investigation, job } = await started();
    await new RepositorySnapshotRepository(db).createForInvestigation(investigation.id, artifact());
    const claimed = await jobs.claimNext({ workerOwner: "worker-success", leaseSeconds: 30 });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") return;
    expect(await jobs.completeSuccess(job.id, claimed.claim.leaseToken)).toEqual({ kind: "updated", status: "succeeded" });
    expect((await investigations.getInvestigation(investigation.id)).status).toBe("planning");
    const planningJob = await db.selectFrom("investigation_jobs").selectAll()
      .where("investigation_id", "=", investigation.id).where("kind", "=", "investigation_planning").executeTakeFirst();
    expect(planningJob?.status).toBe("queued");
    expect(await jobs.completeSuccess(job.id, claimed.claim.leaseToken)).toEqual({ kind: "already_terminal", status: "succeeded" });
    const events = await db.selectFrom("investigation_events").selectAll().where("investigation_id", "=", investigation.id)
      .where("type", "=", "lifecycle_transitioned").execute();
    expect(events).toHaveLength(1);
    expect(events[0].public_payload).toEqual({ from: "snapshotting", to: "planning" });
    await rejectSql((tx) => sql`update investigation_jobs set status='queued',attempt_count=0,started_at=null,
      completed_at=null,available_at=transaction_timestamp(),updated_at=transaction_timestamp() where id=${job.id}`.execute(tx));
    await rejectSql((tx) => sql`update snapshot_job_attempts set status='leased',finished_at=null where job_id=${job.id}`.execute(tx));
  });

  it("retries without lifecycle movement and terminally fails once", async () => {
    const retrying = await started();
    const retryClaim = await jobs.claimNext({ workerOwner: "worker-retry", leaseSeconds: 30 });
    expect(retryClaim.kind).toBe("claimed"); if (retryClaim.kind !== "claimed") return;
    await jobs.scheduleRetry(retrying.job.id, retryClaim.claim.leaseToken, "github_unavailable", 5);
    expect((await investigations.getInvestigation(retrying.investigation.id)).status).toBe("snapshotting");
    expect((await jobs.getJob(retrying.job.id))!.leaseExpiresAt).toBeNull();

    await truncate();
    const failing = await started();
    const failureClaim = await jobs.claimNext({ workerOwner: "worker-fail", leaseSeconds: 30 });
    expect(failureClaim.kind).toBe("claimed"); if (failureClaim.kind !== "claimed") return;
    expect(await jobs.completeFailure(failing.job.id, failureClaim.claim.leaseToken, "repository_private"))
      .toEqual({ kind: "updated", status: "failed" });
    expect(await investigations.getInvestigation(failing.investigation.id)).toMatchObject({ status: "failed", failureCode: "repository_private" });
    expect(await jobs.completeFailure(failing.job.id, failureClaim.claim.leaseToken, "repository_private"))
      .toEqual({ kind: "already_terminal", status: "failed" });
    expect(await db.selectFrom("investigation_events").selectAll().where("investigation_id", "=", failing.investigation.id)
      .where("type", "=", "lifecycle_transitioned").execute()).toHaveLength(1);
  });

  it("cancels unleased or precisely leased obsolete work without failing the investigation", async () => {
    const queued = await started();
    expect(await jobs.cancel(queued.job.id, "obsolete_job")).toEqual({ kind: "updated", status: "cancelled" });
    expect((await investigations.getInvestigation(queued.investigation.id)).status).toBe("snapshotting");
    expect(await jobs.cancel(queued.job.id, "obsolete_job")).toEqual({ kind: "already_terminal", status: "cancelled" });

    await truncate();
    const leased = await started(), claim = await jobs.claimNext({ workerOwner: "worker-cancel", leaseSeconds: 30 });
    expect(claim.kind).toBe("claimed"); if (claim.kind !== "claimed") return;
    expect(await jobs.cancel(leased.job.id, "obsolete_job", randomUUID())).toEqual({ kind: "lease_lost" });
    expect(await jobs.cancel(leased.job.id, "obsolete_job", claim.claim.leaseToken)).toEqual({ kind: "updated", status: "cancelled" });
    expect((await db.selectFrom("snapshot_job_attempts").select("status").where("job_id", "=", leased.job.id).executeTakeFirstOrThrow()).status).toBe("cancelled");
  });

  it("replays an existing immutable snapshot through the worker with zero GitHub build work", async () => {
    const { investigation } = await started();
    const snapshots = new RepositorySnapshotRepository(db);
    await snapshots.createForInvestigation(investigation.id, artifact());
    let builds = 0;
    const service = new RepositorySnapshotService(snapshots, async () => { builds++; return artifact(); });
    const worker = new SnapshotWorker(jobs, service, { owner: "worker-replay", leaseSeconds: 30,
      heartbeatSeconds: 5, pollMs: 250, baseSeconds: 5, maximumSeconds: 300 }, undefined,
      (_milliseconds, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    await expect(worker.runOnce(new AbortController().signal)).resolves.toMatchObject({ status: "succeeded" });
    expect(builds).toBe(0);
  });

  it("reconciles an already-advanced investigation with a valid snapshot without a network attempt", async () => {
    const value = await started();
    await new RepositorySnapshotRepository(db).createForInvestigation(value.investigation.id, artifact());
    await investigations.transitionInvestigation(value.investigation.id, "planning", { expectedStatus: "snapshotting" });
    await expect(jobs.claimNext({ workerOwner: "worker-reconcile", leaseSeconds: 30 }))
      .resolves.toEqual({ kind: "reconciled", jobId: value.job.id, status: "succeeded" });
    expect((await jobs.getJob(value.job.id))!.attemptCount).toBe(0);
    expect(await db.selectFrom("snapshot_job_attempts").selectAll().where("job_id", "=", value.job.id).execute()).toHaveLength(0);
  });

  it("reconciles exhausted and obsolete work without another lease or lifecycle regression", async () => {
    const exhausted = await started();
    let current = await jobs.claimNext({ workerOwner: "worker-exhausted-1", leaseSeconds: 30 });
    for (let attempt = 1; attempt < 4; attempt++) {
      expect(current.kind).toBe("claimed"); if (current.kind !== "claimed") return;
      await jobs.scheduleRetry(exhausted.job.id, current.claim.leaseToken, "internal_error", 1);
      await sql`update investigation_jobs set available_at=transaction_timestamp() where id=${exhausted.job.id}`.execute(db);
      current = await jobs.claimNext({ workerOwner: `worker-exhausted-${attempt + 1}`, leaseSeconds: 30 });
    }
    expect(current.kind).toBe("claimed"); if (current.kind !== "claimed") return;
    await db.transaction().execute(async (tx) => {
      await sql`update snapshot_job_attempts set status='retry_scheduled',finished_at=transaction_timestamp(),
        failure_code='internal_error',next_available_at=transaction_timestamp() where job_id=${exhausted.job.id} and lease_token=${current.claim.leaseToken}`.execute(tx);
      await sql`update investigation_jobs set status='retry_wait',lease_owner=null,lease_token=null,lease_expires_at=null,
        last_heartbeat_at=null,failure_code='internal_error',available_at=transaction_timestamp(),updated_at=transaction_timestamp()
        where id=${exhausted.job.id}`.execute(tx);
    });
    await expect(jobs.claimNext({ workerOwner: "worker-exhausted", leaseSeconds: 30 }))
      .resolves.toEqual({ kind: "reconciled", jobId: exhausted.job.id, status: "failed" });
    expect((await investigations.getInvestigation(exhausted.investigation.id)).status).toBe("failed");
    expect(await db.selectFrom("snapshot_job_attempts").selectAll().where("job_id", "=", exhausted.job.id).execute()).toHaveLength(4);

    await truncate();
    const obsolete = await started();
    await investigations.transitionInvestigation(obsolete.investigation.id, "failed", { failureCode: "external_failure" });
    await expect(jobs.claimNext({ workerOwner: "worker-obsolete", leaseSeconds: 30 }))
      .resolves.toEqual({ kind: "reconciled", jobId: obsolete.job.id, status: "cancelled" });
    expect((await investigations.getInvestigation(obsolete.investigation.id)).status).toBe("failed");
  });

  it("cascades attempts and rolls back injected finalization failure atomically", async () => {
    const value = await started(), claimed = await jobs.claimNext({ workerOwner: "worker-rollback", leaseSeconds: 30 });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") return;
    await new RepositorySnapshotRepository(db).createForInvestigation(value.investigation.id, artifact());
    await db.schema.alterTable("investigation_events").addCheckConstraint("force_worker_event_failure", sql`type <> 'lifecycle_transitioned'`).execute();
    const error = await jobs.completeSuccess(value.job.id, claimed.claim.leaseToken).catch((caught) => caught);
    expect(error).toMatchObject({ code: "internal_error" });
    expect(JSON.stringify(error)).not.toContain("force_worker_event_failure");
    expect(JSON.stringify(error)).not.toContain(claimed.claim.leaseToken);
    await db.schema.alterTable("investigation_events").dropConstraint("force_worker_event_failure").execute();
    expect((await jobs.getJob(value.job.id))!.status).toBe("leased");
    expect((await investigations.getInvestigation(value.investigation.id)).status).toBe("snapshotting");
    expect((await db.selectFrom("snapshot_job_attempts").select("status").where("job_id", "=", value.job.id).executeTakeFirstOrThrow()).status).toBe("leased");
    await db.deleteFrom("investigations").where("id", "=", value.investigation.id).execute();
    expect(await db.selectFrom("snapshot_job_attempts").selectAll().where("job_id", "=", value.job.id).execute()).toHaveLength(0);
  });
});
