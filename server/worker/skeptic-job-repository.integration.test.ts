import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { PLAN_SCHEMA_VERSION } from "@/lib/contracts/investigation-plan";
import type { SkepticArtifact } from "@/lib/contracts/skeptic-challenge";
import { validateSkepticArtifact } from "@/lib/contracts/skeptic-challenge";
import type { Database } from "@/server/db/types";
import { createDisposableTestDatabase } from "@/server/db/test-database";
import { migrateToLatest } from "@/server/db/migrate";
import { TEST_OWNER_USER_ID, seedTestOwner } from "@/server/auth/test-fixtures";
import { InvestigationRepository } from "@/server/persistence/investigation-repository";
import { InvestigationPlanRepository } from "@/server/persistence/investigation-plan-repository";
import { RepositorySnapshotRepository } from "@/server/persistence/repository-snapshot-repository";
import { SkepticRepository } from "@/server/persistence/skeptic-repository";
import { finalizeArtifact } from "@/server/github/manifest";
import type { SnapshotEntry } from "@/server/github/contracts";
import { SnapshotJobRepository } from "./snapshot-job-repository";
import { PlanningJobRepository } from "./planning-job-repository";
import { EvidenceJobRepository } from "./evidence-job-repository";
import { SkepticJobRepository } from "./skeptic-job-repository";
import fixture from "@/server/qwen/fixtures/investigator-readme.json";
import skepticFixture from "@/server/qwen/fixtures/skeptic-readme.json";

let harness: Awaited<ReturnType<typeof createDisposableTestDatabase>>;
let db: Kysely<Database>, investigations: InvestigationRepository, snapshotJobs: SnapshotJobRepository,
  planningJobs: PlanningJobRepository, evidenceJobs: EvidenceJobRepository, skepticJobs: SkepticJobRepository,
  skepticRepository: SkepticRepository;
const input = { repositoryUrl: "https://github.com/Acme/Widget", claim: { statement: "A safe claim." } };
const approval = { statement: "A safe claim.", preservedQualifiers: [], approved: true as const };

async function truncate() {
  await sql`truncate challenge_resolutions, skeptic_challenges, skeptic_analyses, skeptic_job_attempts,
    counterevidence_items, evidence_gaps, evidence_excerpts, evidence_candidates, evidence_task_runs,
    evidence_job_attempts, model_invocations, evidence_task_obligations, evidence_tasks, verification_obligations,
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
async function atChallenging() {
  const created = await investigations.createInvestigation(input, randomUUID(), TEST_OWNER_USER_ID);
  await investigations.approveClaim(created.id, approval, TEST_OWNER_USER_ID);
  const investigation = await investigations.startInvestigation(created.id, randomUUID(), TEST_OWNER_USER_ID);
  const snapshotJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id)
    .where("kind", "=", "repository_snapshot").executeTakeFirstOrThrow();
  await new RepositorySnapshotRepository(db).createForInvestigation(created.id, artifact());
  const snapshotClaim = await snapshotJobs.claimNext({ workerOwner: "snapshot-worker", leaseSeconds: 30 });
  expect(snapshotClaim.kind).toBe("claimed"); if (snapshotClaim.kind !== "claimed") throw new Error("claim failed");
  await snapshotJobs.completeSuccess(snapshotJob.id, snapshotClaim.claim.leaseToken);
  const planningJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id)
    .where("kind", "=", "investigation_planning").executeTakeFirstOrThrow();
  const claimRow = await db.selectFrom("manual_claims").select("id").where("investigation_id", "=", created.id).executeTakeFirstOrThrow();
  const planningClaim = await planningJobs.claimNext({ workerOwner: "planning-worker", leaseSeconds: 30 });
  expect(planningClaim.kind).toBe("claimed"); if (planningClaim.kind !== "claimed") throw new Error("claim failed");
  await new InvestigationPlanRepository(db).createForInvestigation(created.id, planArtifact(created.id, claimRow.id), {
    modelId: "qwen-plus", promptVersion: "planning-v1", attemptId: planningClaim.claim.attemptId,
  });
  await planningJobs.completeSuccess(planningJob.id, planningClaim.claim.leaseToken);
  const evidenceJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id)
    .where("kind", "=", "investigation_evidence").executeTakeFirstOrThrow();
  const run = await db.selectFrom("evidence_task_runs").selectAll().where("investigation_id", "=", created.id).executeTakeFirstOrThrow();
  const snapshot = await db.selectFrom("repository_snapshots").selectAll().where("investigation_id", "=", created.id).executeTakeFirstOrThrow();
  const now = new Date();
  await db.updateTable("evidence_task_runs").set({
    status: "succeeded", finished_at: now,
    canonical_result: JSON.stringify({ ...fixture, claimId: claimRow.id }),
  }).where("id", "=", run.id).execute();
  await db.insertInto("evidence_candidates").values({
    id: randomUUID(), run_id: run.id, investigation_id: created.id, claim_id: claimRow.id, snapshot_id: snapshot.id,
    candidate_key: "cand_readme", evidence_type: "repository_structure", observation: "README exists.",
    strength: "moderate", manifest_hash_sha256: snapshot.manifest_hash_sha256, commit_sha: snapshot.commit_sha, created_at: now,
  }).execute();
  const candidate = await db.selectFrom("evidence_candidates").select("id").where("run_id", "=", run.id).executeTakeFirstOrThrow();
  await db.insertInto("evidence_excerpts").values({
    id: randomUUID(), candidate_id: candidate.id, path: "README.md",
    line_start: 1, line_end: 1, normalized_sha256: "c".repeat(64), excerpt_text: "hello",
  }).execute();
  const evidenceClaim = await evidenceJobs.claimNext({ workerOwner: "evidence-worker", leaseSeconds: 60 });
  expect(evidenceClaim.kind).toBe("reconciled");
  const skepticJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", created.id)
    .where("kind", "=", "investigation_skeptic").executeTakeFirstOrThrow();
  return { investigation, skepticJob, claimId: claimRow.id, runId: run.id, snapshot };
}

beforeAll(async () => {
  harness = await createDisposableTestDatabase(); db = harness.db;
  investigations = new InvestigationRepository(db);
  snapshotJobs = new SnapshotJobRepository(db);
  planningJobs = new PlanningJobRepository(db);
  evidenceJobs = new EvidenceJobRepository(db);
  skepticJobs = new SkepticJobRepository(db);
  skepticRepository = new SkepticRepository(db);
  await migrateToLatest(db);
});
beforeEach(async () => {
  await migrateToLatest(db);
  await truncate();
  await seedTestOwner(db);
});
afterAll(async () => { await harness?.cleanup(); });

describe.sequential("durable skeptic job orchestration", () => {
  it("installs skeptic tables, job kind extension, and attempt history", async () => {
    const tables = await sql<{ table_name: string }>`select table_name from information_schema.tables
      where table_schema='public' and table_name in ('skeptic_analyses','skeptic_challenges','challenge_resolutions','skeptic_job_attempts')
      order by table_name`.execute(db);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "challenge_resolutions", "skeptic_analyses", "skeptic_challenges", "skeptic_job_attempts",
    ]);
    const indexes = await sql<{ indexname: string }>`select indexname from pg_indexes where schemaname='public'
      and indexname='investigation_jobs_active_skeptic_idx'`.execute(db);
    expect(indexes.rows).toHaveLength(1);
  });

  it("enqueues skeptic jobs when evidence collection completes", async () => {
    const { investigation, skepticJob } = await atChallenging();
    expect((await investigations.getInvestigation(investigation.id, TEST_OWNER_USER_ID)).status).toBe("challenging");
    expect(skepticJob.status).toBe("queued");
    const started = await db.selectFrom("investigation_events").selectAll().where("investigation_id", "=", investigation.id)
      .where("type", "=", "investigation_started").where("stage", "=", "challenging").execute();
    expect(started.some((event) => {
      const payload = typeof event.public_payload === "string" ? JSON.parse(event.public_payload) : event.public_payload;
      return payload.jobKind === "investigation_skeptic";
    })).toBe(true);
  });

  it("advances challenging to judging when skeptic clears the investigation", async () => {
    const { investigation, skepticJob, claimId, snapshot } = await atChallenging();
    const claimed = await skepticJobs.claimNext({ workerOwner: "skeptic-worker", leaseSeconds: 60 });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") throw new Error("claim failed");
    const artifact = validateSkepticArtifact({
      ...skepticFixture,
      investigationId: investigation.id,
      snapshotManifestHash: snapshot.manifest_hash_sha256,
      commitSha: snapshot.commit_sha,
      claimAnalyses: [{ ...skepticFixture.claimAnalyses[0], claimId }],
      challenges: [{ ...skepticFixture.challenges[0], claimId }],
    });
    await skepticRepository.createForInvestigation(investigation.id, artifact, {
      modelId: "qwen-plus", promptVersion: "skeptic-v1", attemptId: claimed.claim.attemptId,
    });
    expect(await skepticJobs.completeSuccess(skepticJob.id, claimed.claim.leaseToken)).toEqual({ kind: "updated", status: "succeeded" });
    expect((await investigations.getInvestigation(investigation.id, TEST_OWNER_USER_ID)).status).toBe("judging");
  });

  it("routes reinvestigation through supplemental evidence to judging", async () => {
    const { investigation, skepticJob, claimId, snapshot, runId } = await atChallenging();
    const claimed = await skepticJobs.claimNext({ workerOwner: "skeptic-worker", leaseSeconds: 60 });
    expect(claimed.kind).toBe("claimed"); if (claimed.kind !== "claimed") throw new Error("claim failed");
    const artifact = validateSkepticArtifact({
      ...skepticFixture,
      investigationId: investigation.id,
      snapshotManifestHash: snapshot.manifest_hash_sha256,
      commitSha: snapshot.commit_sha,
      outcome: "reinvestigation_required",
      reinvestigationTaskKeys: ["task_readme"],
      claimAnalyses: [{ ...skepticFixture.claimAnalyses[0], claimId }],
      challenges: [{ ...skepticFixture.challenges[0], claimId, requestedReinvestigation: true, severity: "major" }],
    });
    await skepticRepository.createForInvestigation(investigation.id, artifact, {
      modelId: "qwen-plus", promptVersion: "skeptic-v1", attemptId: claimed.claim.attemptId,
    });
    expect(await skepticJobs.completeSuccess(skepticJob.id, claimed.claim.leaseToken)).toEqual({ kind: "updated", status: "succeeded" });
    expect((await investigations.getInvestigation(investigation.id, TEST_OWNER_USER_ID)).status).toBe("reinvestigating");
    const reinvestigation = await db.selectFrom("investigations").select("reinvestigation_cycle_count")
      .where("id", "=", investigation.id).executeTakeFirstOrThrow();
    expect(reinvestigation.reinvestigation_cycle_count).toBe(1);
    const resetRun = await db.selectFrom("evidence_task_runs").selectAll().where("id", "=", runId).executeTakeFirstOrThrow();
    expect(resetRun).toMatchObject({ status: "queued", canonical_result: null, failure_code: null, finished_at: null });
    const evidenceJob = await db.selectFrom("investigation_jobs").selectAll().where("investigation_id", "=", investigation.id)
      .where("kind", "=", "investigation_evidence").where("status", "=", "queued").executeTakeFirstOrThrow();
    const now = new Date();
    await db.updateTable("evidence_task_runs").set({
      status: "succeeded", finished_at: now,
      canonical_result: JSON.stringify({ ...fixture, claimId }),
    }).where("id", "=", runId).execute();
    const candidateId = randomUUID();
    await db.insertInto("evidence_candidates").values({
      id: candidateId, run_id: runId, investigation_id: investigation.id, claim_id: claimId, snapshot_id: snapshot.id,
      candidate_key: "cand_readme_retry", evidence_type: "repository_structure", observation: "README still exists.",
      strength: "moderate", manifest_hash_sha256: snapshot.manifest_hash_sha256, commit_sha: snapshot.commit_sha, created_at: now,
    }).execute();
    const evidenceClaim = await evidenceJobs.claimNext({ workerOwner: "evidence-worker", leaseSeconds: 60 });
    expect(evidenceClaim).toMatchObject({ kind: "reconciled", status: "succeeded" });
    expect((await investigations.getInvestigation(investigation.id, TEST_OWNER_USER_ID)).status).toBe("judging");
    expect((await evidenceJobs.getJob(evidenceJob.id))!.status).toBe("succeeded");
  });
});
