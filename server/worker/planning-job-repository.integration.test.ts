import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely, type Transaction } from "kysely";
import { PLAN_SCHEMA_VERSION } from "@/lib/contracts/investigation-plan";
import type { Database } from "@/server/db/types";
import { createDisposableTestDatabase } from "@/server/db/test-database";
import { migrateToLatest } from "@/server/db/migrate";
import { InvestigationRepository } from "@/server/persistence/investigation-repository";
import { InvestigationPlanRepository } from "@/server/persistence/investigation-plan-repository";
import { RepositorySnapshotRepository } from "@/server/persistence/repository-snapshot-repository";
import { finalizeArtifact } from "@/server/github/manifest";
import type { SnapshotEntry } from "@/server/github/contracts";
import { SnapshotJobRepository } from "./snapshot-job-repository";
import { PlanningJobRepository } from "./planning-job-repository";
import { PlanningWorker } from "./planning-worker";

let harness: Awaited<ReturnType<typeof createDisposableTestDatabase>>;
let db: Kysely<Database>, investigations: InvestigationRepository, snapshotJobs: SnapshotJobRepository, planningJobs: PlanningJobRepository;
const input = { repositoryUrl: "https://github.com/Acme/Widget", claim: { statement: "A safe claim." } };
const approval = { statement: "A safe claim.", preservedQualifiers: [], approved: true as const };

async function truncate() {
  await sql`truncate model_invocations, evidence_task_obligations, evidence_tasks, verification_obligations,
    investigation_plans, planning_job_attempts, snapshot_job_attempts, repository_snapshot_files,
    repository_snapshot_entries, repository_snapshots, investigation_jobs, idempotency_records,
    investigation_events, manual_claims, investigations restart identity cascade`.execute(db);
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
function planArtifact(investigationId: string, claimId: string) {
  const built = artifact();
  return {
    schemaVersion: PLAN_SCHEMA_VERSION, investigationId,
    snapshotManifestHash: built.manifestHashSha256, commitSha: built.commitSha,
    claimPlans: [{
      claimId, obligations: [{ id: "obl_readme", claimId, description: "README exists.", priority: 1 }],
      evidenceTasks: [{
        id: "task_readme", obligationIds: ["obl_readme"], specialistCapability: "repository_investigator" as const,
        expectedEvidenceTypes: ["repository_structure" as const], queryTerms: ["README"], priority: 1, dependsOnTaskIds: [],
      }],
      knownLimitations: ["Static inspection only."],
    }],
  };
}
async function atPlanning() {
  const created = await investigations.createInvestigation(input, randomUUID());
  await investigations.approveClaim(created.id, approval);
  const investigation = await investigations.startInvestigation(created.id, randomUUID());
  const snapshotJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id)
    .where("kind", "=", "repository_snapshot").executeTakeFirstOrThrow();
  await new RepositorySnapshotRepository(db).createForInvestigation(created.id, artifact());
  const claim = await snapshotJobs.claimNext({ workerOwner: "snapshot-worker", leaseSeconds: 30 });
  expect(claim.kind).toBe("claimed"); if (claim.kind !== "claimed") throw new Error("claim failed");
  await snapshotJobs.completeSuccess(snapshotJob.id, claim.claim.leaseToken);
  const planningJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id)
    .where("kind", "=", "investigation_planning").executeTakeFirstOrThrow();
  const claimRow = await db.selectFrom("manual_claims").select("id").where("investigation_id", "=", created.id).executeTakeFirstOrThrow();
  return { investigation, planningJob, claimId: claimRow.id };
}

beforeAll(async () => {
  harness = await createDisposableTestDatabase(); db = harness.db;
  investigations = new InvestigationRepository(db);
  snapshotJobs = new SnapshotJobRepository(db);
  planningJobs = new PlanningJobRepository(db);
  await migrateToLatest(db);
});
beforeEach(truncate);
afterAll(async () => { await harness?.cleanup(); });

describe.sequential("durable planning job orchestration", () => {
  it("installs planning tables, job kind extension, and planning attempt history", async () => {
    const tables = await sql<{ table_name: string }>`select table_name from information_schema.tables
      where table_schema='public' and table_name in ('investigation_plans','verification_obligations','evidence_tasks',
      'evidence_task_obligations','planning_job_attempts','model_invocations') order by table_name`.execute(db);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "evidence_task_obligations", "evidence_tasks", "investigation_plans", "model_invocations",
      "planning_job_attempts", "verification_obligations",
    ]);
    const indexes = await sql<{ indexname: string }>`select indexname from pg_indexes where schemaname='public'
      and indexname='investigation_jobs_active_planning_idx'`.execute(db);
    expect(indexes.rows).toHaveLength(1);
  });

  it("claims planning jobs with skip-locked fencing and advances planning to investigating", async () => {
    const { investigation, planningJob, claimId } = await atPlanning();
    const claimed = await planningJobs.claimNext({ workerOwner: "planning-worker", leaseSeconds: 30 });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") return;
    const plans = new InvestigationPlanRepository(db);
    await plans.createForInvestigation(investigation.id, planArtifact(investigation.id, claimId), {
      modelId: "qwen-plus", promptVersion: "planning-v1", attemptId: claimed.claim.attemptId,
    });
    expect(await planningJobs.completeSuccess(planningJob.id, claimed.claim.leaseToken)).toEqual({ kind: "updated", status: "succeeded" });
    expect((await investigations.getInvestigation(investigation.id)).status).toBe("investigating");
    const events = await db.selectFrom("investigation_events").selectAll().where("investigation_id", "=", investigation.id)
      .where("type", "=", "lifecycle_transitioned").where("stage", "=", "investigating").execute();
    expect(events).toHaveLength(1);
    const invocations = await db.selectFrom("model_invocations").selectAll().execute();
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ attempt_id: claimed.claim.attemptId, status: "succeeded", model_id: "qwen-plus" });
  });

  it("uses skip-locked claims exactly once under races", async () => {
    const first = await atPlanning(), second = await atPlanning(), third = await atPlanning();
    const early = new Date(Date.now() - 3_000), late = new Date(Date.now() - 2_000), latest = new Date(Date.now() - 1_000);
    await db.updateTable("investigation_jobs").set({ created_at: early, available_at: early, updated_at: new Date() })
      .where("id", "=", first.planningJob.id).execute();
    await db.updateTable("investigation_jobs").set({ created_at: late, available_at: late, updated_at: new Date() })
      .where("id", "=", second.planningJob.id).execute();
    await db.updateTable("investigation_jobs").set({ created_at: latest, available_at: latest, updated_at: new Date() })
      .where("id", "=", third.planningJob.id).execute();
    const ordered = await planningJobs.claimNext({ workerOwner: "planning-order", leaseSeconds: 30 });
    expect(ordered).toMatchObject({ kind: "claimed", claim: { jobId: first.planningJob.id } });
    const [a, b] = await Promise.all([
      planningJobs.claimNext({ workerOwner: "planning-a", leaseSeconds: 30 }),
      planningJobs.claimNext({ workerOwner: "planning-b", leaseSeconds: 30 }),
    ]);
    expect([a, b].every((value) => value.kind === "claimed")).toBe(true);
    expect(new Set([a.kind === "claimed" ? a.claim.jobId : "", b.kind === "claimed" ? b.claim.jobId : ""]))
      .toEqual(new Set([second.planningJob.id, third.planningJob.id]));
    expect(await db.selectFrom("planning_job_attempts").selectAll().orderBy("started_at").execute()).toHaveLength(3);

    await truncate();
    const one = await atPlanning();
    const raced = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      planningJobs.claimNext({ workerOwner: `planning-race-${index}`, leaseSeconds: 30 })));
    expect(raced.filter((value) => value.kind === "claimed")).toHaveLength(1);
    expect(raced.filter((value) => value.kind === "idle")).toHaveLength(9);
    expect(await db.selectFrom("planning_job_attempts").selectAll().where("job_id", "=", one.planningJob.id).execute()).toHaveLength(1);
  });

  it("persists retry delay, heartbeat extension, expiry recovery, and stale-token fencing", async () => {
    const { investigation, planningJob, claimId } = await atPlanning();
    const first = await planningJobs.claimNext({ workerOwner: "planning-first", leaseSeconds: 30 });
    expect(first.kind).toBe("claimed"); if (first.kind !== "claimed") return;
    const originalExpiry = first.claim.leaseExpiresAt;
    await expect(planningJobs.heartbeat(planningJob.id, first.claim.leaseToken, 60)).resolves.toMatchObject({ kind: "updated" });
    expect((await planningJobs.getJob(planningJob.id))!.leaseExpiresAt!.getTime()).toBeGreaterThan(originalExpiry.getTime());
    await expect(planningJobs.scheduleRetry(planningJob.id, first.claim.leaseToken, "qwen_unavailable", 60))
      .resolves.toMatchObject({ kind: "updated", status: "retry_wait" });
    await expect(planningJobs.claimNext({ workerOwner: "planning-early", leaseSeconds: 30 })).resolves.toEqual({ kind: "idle" });
    await sql`update investigation_jobs set available_at=transaction_timestamp() where id=${planningJob.id}`.execute(db);
    const second = await planningJobs.claimNext({ workerOwner: "planning-second", leaseSeconds: 30 });
    expect(second).toMatchObject({ kind: "claimed", claim: { attemptNumber: 2 } });
    if (second.kind !== "claimed") return;
    await sql`update investigation_jobs set created_at=transaction_timestamp()-interval '3 seconds',
      started_at=transaction_timestamp()-interval '2 seconds',last_heartbeat_at=transaction_timestamp()-interval '2 seconds',
      lease_expires_at=transaction_timestamp()-interval '1 second',updated_at=transaction_timestamp() where id=${planningJob.id}`.execute(db);
    expect(await planningJobs.heartbeat(planningJob.id, second.claim.leaseToken, 30)).toEqual({ kind: "lease_lost" });
    const replacement = await planningJobs.claimNext({ workerOwner: "planning-replacement", leaseSeconds: 30 });
    expect(replacement).toMatchObject({ kind: "claimed", claim: { attemptNumber: 3 } });
    if (replacement.kind !== "claimed") return;
    expect(await planningJobs.heartbeat(planningJob.id, second.claim.leaseToken, 30)).toEqual({ kind: "lease_lost" });
    expect(await planningJobs.completeSuccess(planningJob.id, second.claim.leaseToken)).toEqual({ kind: "lease_lost" });
    expect(await planningJobs.scheduleRetry(planningJob.id, second.claim.leaseToken, "qwen_unavailable", 5)).toEqual({ kind: "lease_lost" });
    expect(await planningJobs.completeFailure(planningJob.id, second.claim.leaseToken, "plan_schema_invalid")).toEqual({ kind: "lease_lost" });
    await new InvestigationPlanRepository(db).createForInvestigation(investigation.id, planArtifact(investigation.id, claimId), {
      modelId: "qwen-plus", promptVersion: "planning-v1", attemptId: replacement.claim.attemptId,
    });
    expect(await planningJobs.completeSuccess(planningJob.id, replacement.claim.leaseToken)).toEqual({ kind: "updated", status: "succeeded" });
    const history = await db.selectFrom("planning_job_attempts").select(["attempt_number", "status"]).where("job_id", "=", planningJob.id)
      .orderBy("attempt_number").execute();
    expect(history).toEqual([
      { attempt_number: 1, status: "retry_scheduled" },
      { attempt_number: 2, status: "lease_expired" },
      { attempt_number: 3, status: "succeeded" },
    ]);
  });

  it("replays an existing plan through the worker with zero provider calls", async () => {
    const { investigation, claimId } = await atPlanning();
    const plans = new InvestigationPlanRepository(db);
    await plans.createForInvestigation(investigation.id, planArtifact(investigation.id, claimId), {
      modelId: "qwen-plus", promptVersion: "planning-v1",
    });
    let calls = 0;
    const planner = { generatePlan: async () => {
      calls++;
      const plan = await plans.findByInvestigation(investigation.id);
      if (!plan) throw new Error("missing plan");
      return plan;
    } };
    const worker = new PlanningWorker(planningJobs, planner, {
      owner: "planning-replay", leaseSeconds: 30, heartbeatSeconds: 5, pollMs: 250, baseSeconds: 5, maximumSeconds: 300,
    });
    await expect(worker.runOnce(new AbortController().signal)).resolves.toMatchObject({ status: "succeeded" });
    expect(calls).toBe(0);
    expect((await investigations.getInvestigation(investigation.id)).status).toBe("investigating");
  });

  it("retries without lifecycle movement and terminally fails planning investigations", async () => {
    const { investigation, planningJob } = await atPlanning();
    const claim = await planningJobs.claimNext({ workerOwner: "planning-retry", leaseSeconds: 30 });
    expect(claim.kind).toBe("claimed"); if (claim.kind !== "claimed") return;
    await planningJobs.scheduleRetry(planningJob.id, claim.claim.leaseToken, "qwen_unavailable", 5);
    expect((await investigations.getInvestigation(investigation.id)).status).toBe("planning");

    await truncate();
    const next = await atPlanning();
    const failureClaim = await planningJobs.claimNext({ workerOwner: "planning-fail", leaseSeconds: 30 });
    expect(failureClaim.kind).toBe("claimed"); if (failureClaim.kind !== "claimed") return;
    expect(await planningJobs.completeFailure(next.planningJob.id, failureClaim.claim.leaseToken, "plan_schema_invalid"))
      .toEqual({ kind: "updated", status: "failed" });
    expect((await investigations.getInvestigation(next.investigation.id)).status).toBe("failed");
  });

  it("rolls back injected planning finalization failure atomically", async () => {
    const { investigation, planningJob } = await atPlanning();
    const claimed = await planningJobs.claimNext({ workerOwner: "planning-rollback", leaseSeconds: 30 });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") return;
    const claimRow = await db.selectFrom("manual_claims").select("id").where("investigation_id", "=", investigation.id).executeTakeFirstOrThrow();
    await new InvestigationPlanRepository(db).createForInvestigation(investigation.id, planArtifact(investigation.id, claimRow.id), {
      modelId: "qwen-plus", promptVersion: "planning-v1",
    });
    await sql`alter table investigation_events add constraint force_planning_event_failure check (type <> 'lifecycle_transitioned') not valid`.execute(db);
    const error = await planningJobs.completeSuccess(planningJob.id, claimed.claim.leaseToken).catch((caught) => caught);
    expect(error).toMatchObject({ code: "internal_error" });
    await db.schema.alterTable("investigation_events").dropConstraint("force_planning_event_failure").execute();
    expect((await planningJobs.getJob(planningJob.id))!.status).toBe("leased");
    expect((await investigations.getInvestigation(investigation.id)).status).toBe("planning");
  });
});
