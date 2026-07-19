import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import {
  SkepticArtifactSchema,
  validateSkepticArtifact,
  type SkepticArtifact,
} from "@/lib/contracts/skeptic-challenge";
import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import { loadPersistedPlan } from "./investigation-plan-repository";
import { loadPersistedSnapshot } from "./repository-snapshot-repository";
import { PublicInvestigationEventSchema } from "./events";
import { buildEvidenceIndex, validateChallengeEvidenceRefs, validateReinvestigationTaskKeys } from "@/server/skeptic/challenge-provenance";

export type PersistedSkepticAnalysis = Readonly<{
  id: string;
  investigationId: string;
  outcome: SkepticArtifact["outcome"];
  reinvestigationCycle: number;
  artifact: SkepticArtifact;
}>;

type Db = Kysely<Database> | Transaction<Database>;

export async function loadPersistedSkepticAnalysis(db: Db, investigationId: string, cycle?: number): Promise<PersistedSkepticAnalysis | null> {
  let query = db.selectFrom("skeptic_analyses").selectAll().where("investigation_id", "=", investigationId);
  if (cycle !== undefined) query = query.where("reinvestigation_cycle", "=", cycle);
  else {
    const investigation = await db.selectFrom("investigations").select("reinvestigation_cycle_count").where("id", "=", investigationId).executeTakeFirst();
    if (!investigation) return null;
    query = query.where("reinvestigation_cycle", "=", investigation.reinvestigation_cycle_count);
  }
  const row = await query.executeTakeFirst();
  if (!row) return null;
  const artifact = SkepticArtifactSchema.parse(typeof row.canonical_artifact === "string" ? JSON.parse(row.canonical_artifact) : row.canonical_artifact);
  if (artifact.investigationId !== investigationId) throw new ApplicationError("internal_error", {});
  return {
    id: row.id, investigationId: row.investigation_id, outcome: row.outcome,
    reinvestigationCycle: row.reinvestigation_cycle, artifact,
  };
}

export async function isSkepticComplete(db: Db, investigationId: string): Promise<boolean> {
  return Boolean(await loadPersistedSkepticAnalysis(db, investigationId));
}

function challengeDisposition(challenge: SkepticArtifact["challenges"][number]): "accepted" | "deferred_to_judge" | "triggers_reinvestigation" {
  if (challenge.requestedReinvestigation && (challenge.severity === "critical" || challenge.severity === "major")) {
    return "triggers_reinvestigation";
  }
  return "deferred_to_judge";
}

export class SkepticRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID) {}

  async findByInvestigation(rawInvestigationId: unknown): Promise<PersistedSkepticAnalysis | null> {
    const investigationId = InvestigationIdSchema.parse(rawInvestigationId);
    try {
      return await loadPersistedSkepticAnalysis(this.db, investigationId);
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async loadSkepticContext(investigationId: string): Promise<Readonly<{
    investigationId: string;
    reinvestigationCycle: number;
    claim: Readonly<{ id: string; statement: string; preservedQualifiers: string[] }>;
    obligations: readonly Readonly<{ key: string; description: string }>[];
    snapshot: NonNullable<Awaited<ReturnType<typeof loadPersistedSnapshot>>>;
    evidenceSummary: unknown;
  }> | null> {
    const investigation = await this.db.selectFrom("investigations").select(["id", "status", "reinvestigation_cycle_count"])
      .where("id", "=", investigationId).executeTakeFirst();
    if (!investigation) return null;
    const claim = await this.db.selectFrom("manual_claims").select(["id", "statement", "preserved_qualifiers"])
      .where("investigation_id", "=", investigationId).executeTakeFirst();
    if (!claim) return null;
    const snapshot = await loadPersistedSnapshot(this.db, investigationId);
    if (!snapshot) throw new ApplicationError("conflict", {});
    const obligations = await this.db.selectFrom("verification_obligations").select(["obligation_key", "description"])
      .innerJoin("investigation_plans", "investigation_plans.id", "verification_obligations.plan_id")
      .where("investigation_plans.investigation_id", "=", investigationId).execute();
    const runs = await this.db.selectFrom("evidence_task_runs").selectAll().where("investigation_id", "=", investigationId).execute();
    const tasks = [];
    for (const run of runs) {
      const candidates = await this.db.selectFrom("evidence_candidates").selectAll().where("run_id", "=", run.id).execute();
      const candidateSummaries = [];
      for (const candidate of candidates) {
        const excerpts = await this.db.selectFrom("evidence_excerpts").select(["path", "line_start", "line_end", "excerpt_text"])
          .where("candidate_id", "=", candidate.id).execute();
        candidateSummaries.push({
          candidateKey: candidate.candidate_key, evidenceType: candidate.evidence_type,
          strength: candidate.strength, observation: candidate.observation,
          excerpts: excerpts.map((excerpt) => ({
            path: excerpt.path, lineStart: excerpt.line_start, lineEnd: excerpt.line_end, excerptText: excerpt.excerpt_text,
          })),
        });
      }
      const gaps = await this.db.selectFrom("evidence_gaps").select(["gap_key", "description", "impact"]).where("run_id", "=", run.id).execute();
      const counters = await this.db.selectFrom("counterevidence_items").select(["counter_key", "description", "severity", "related_candidate_key"])
        .where("run_id", "=", run.id).execute();
      tasks.push({
        taskKey: run.task_key, status: run.status, specialistCapability: run.specialist_capability,
        candidates: candidateSummaries,
        gaps: gaps.map((gap) => ({ id: gap.gap_key, description: gap.description, impact: gap.impact })),
        counterevidence: counters.map((item) => ({
          id: item.counter_key, description: item.description, severity: item.severity, relatedCandidateId: item.related_candidate_key,
        })),
      });
    }
    return {
      investigationId, reinvestigationCycle: investigation.reinvestigation_cycle_count,
      claim: {
        id: claim.id, statement: claim.statement,
        preservedQualifiers: Array.isArray(claim.preserved_qualifiers) ? claim.preserved_qualifiers as string[] : JSON.parse(String(claim.preserved_qualifiers)),
      },
      obligations: obligations.map((row) => ({ key: row.obligation_key, description: row.description })),
      snapshot,
      evidenceSummary: {
        manifestHashSha256: snapshot.manifestHashSha256, commitSha: snapshot.commitSha, tasks,
      },
    };
  }

  async createForInvestigation(investigationId: string, artifact: SkepticArtifact, modelMeta: Readonly<{
    modelId: string; promptVersion: string; attemptId?: string | null;
    inputTokenEstimate?: number | null; outputTokenEstimate?: number | null;
  }>): Promise<PersistedSkepticAnalysis> {
    const parsed = validateSkepticArtifact(artifact);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const existing = await loadPersistedSkepticAnalysis(tx, investigationId);
        if (existing) return existing;
        const investigation = await tx.selectFrom("investigations").select(["id", "reinvestigation_cycle_count"])
          .where("id", "=", investigationId).forUpdate().executeTakeFirst();
        if (!investigation) throw new ApplicationError("not_found", {});
        const plan = await loadPersistedPlan(tx, investigationId);
        if (!plan) throw new ApplicationError("conflict", {});
        const snapshot = await loadPersistedSnapshot(tx, investigationId);
        if (!snapshot) throw new ApplicationError("conflict", {});
        if (parsed.snapshotManifestHash !== snapshot.manifestHashSha256 || parsed.commitSha !== snapshot.commitSha) {
          throw new ApplicationError("malformed_input", {});
        }
        const claim = await tx.selectFrom("manual_claims").select("id").where("investigation_id", "=", investigationId).executeTakeFirstOrThrow();
        if (parsed.claimAnalyses.some((analysis) => analysis.claimId !== claim.id) ||
            parsed.challenges.some((challenge) => challenge.claimId !== claim.id)) {
          throw new ApplicationError("malformed_input", {});
        }
        const evidenceRows = await tx.selectFrom("evidence_candidates")
          .leftJoin("evidence_excerpts", "evidence_excerpts.candidate_id", "evidence_candidates.id")
          .select(["evidence_candidates.candidate_key as candidate_key", "evidence_excerpts.path as path",
            "evidence_excerpts.line_start as line_start", "evidence_excerpts.line_end as line_end"])
          .where("evidence_candidates.investigation_id", "=", investigationId).execute();
        validateChallengeEvidenceRefs(parsed, buildEvidenceIndex(evidenceRows));
        const taskRuns = await tx.selectFrom("evidence_task_runs").select(["task_key", "specialist_capability"])
          .where("investigation_id", "=", investigationId).execute();
        validateReinvestigationTaskKeys(parsed, taskRuns);
        const now = this.clock();
        const analysisId = this.id();
        await tx.insertInto("skeptic_analyses").values({
          id: analysisId, investigation_id: investigationId, plan_id: plan.id, snapshot_id: snapshot.id,
          claim_id: claim.id, manifest_hash_sha256: snapshot.manifestHashSha256, commit_sha: snapshot.commitSha,
          schema_version: parsed.schemaVersion, model_id: modelMeta.modelId, prompt_version: modelMeta.promptVersion,
          outcome: parsed.outcome, reinvestigation_cycle: investigation.reinvestigation_cycle_count,
          challenge_count: parsed.challenges.length, canonical_artifact: JSON.stringify(parsed), created_at: now,
        }).execute();
        for (const challenge of parsed.challenges) {
          const challengeId = this.id();
          await tx.insertInto("skeptic_challenges").values({
            id: challengeId, analysis_id: analysisId, investigation_id: investigationId, claim_id: challenge.claimId,
            challenge_key: challenge.id, challenge_type: challenge.challengeType, severity: challenge.severity,
            summary: challenge.summary, reasoning: challenge.reasoning,
            evidence_refs: JSON.stringify(challenge.evidenceRefs),
            related_candidate_keys: JSON.stringify(challenge.relatedCandidateKeys),
            requested_reinvestigation: challenge.requestedReinvestigation, created_at: now,
          }).execute();
          await tx.insertInto("challenge_resolutions").values({
            id: this.id(), challenge_id: challengeId, disposition: challengeDisposition(challenge),
            resolution_note: challenge.requestedReinvestigation
              ? "Challenge flagged for reinvestigation or judge review."
              : "Challenge recorded for judge review.", created_at: now,
          }).execute();
        }
        const event = PublicInvestigationEventSchema.parse({
          type: "skeptic_analysis_persisted", stage: "challenging",
          payload: {
            analysisId, outcome: parsed.outcome, challengeCount: parsed.challenges.length,
            schemaVersion: 1, modelId: modelMeta.modelId, promptVersion: modelMeta.promptVersion,
          },
        });
        await tx.insertInto("investigation_events").values({
          investigation_id: investigationId, type: event.type, stage: event.stage,
          public_payload: JSON.stringify(event.payload), created_at: now,
        }).execute();
        if (modelMeta.attemptId) {
          await tx.insertInto("model_invocations").values({
            plan_id: plan.id, attempt_id: modelMeta.attemptId, model_id: modelMeta.modelId,
            prompt_version: modelMeta.promptVersion, input_token_estimate: modelMeta.inputTokenEstimate ?? null,
            output_token_estimate: modelMeta.outputTokenEstimate ?? null, status: "succeeded", failure_code: null, created_at: now,
          }).execute();
        }
        return { id: analysisId, investigationId, outcome: parsed.outcome, reinvestigationCycle: investigation.reinvestigation_cycle_count, artifact: parsed };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async prepareReinvestigation(investigationId: string, taskKeys: readonly string[]): Promise<void> {
    try {
      await this.db.transaction().execute(async (tx) => {
        await prepareReinvestigation(tx, investigationId, taskKeys, this.clock);
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }
}

export async function prepareReinvestigation(db: Db, investigationId: string, taskKeys: readonly string[],
  clock: () => Date = () => new Date()): Promise<void> {
  if (taskKeys.length === 0) throw new ApplicationError("malformed_input", {});
  const now = clock();
  const investigation = await db.selectFrom("investigations").select(["id", "reinvestigation_cycle_count"])
    .where("id", "=", investigationId).forUpdate().executeTakeFirst();
  if (!investigation) throw new ApplicationError("not_found", {});
  const runs = await db.selectFrom("evidence_task_runs").selectAll()
    .where("investigation_id", "=", investigationId).where("task_key", "in", [...taskKeys]).forUpdate().execute();
  if (runs.length !== taskKeys.length) throw new ApplicationError("malformed_input", {});
  for (const run of runs) {
    if (run.specialist_capability !== "repository_investigator") throw new ApplicationError("conflict", {});
    const candidates = await db.selectFrom("evidence_candidates").select("id").where("run_id", "=", run.id).execute();
    for (const candidate of candidates) {
      await db.deleteFrom("evidence_excerpts").where("candidate_id", "=", candidate.id).execute();
    }
    await db.deleteFrom("evidence_candidates").where("run_id", "=", run.id).execute();
    await db.deleteFrom("evidence_gaps").where("run_id", "=", run.id).execute();
    await db.deleteFrom("counterevidence_items").where("run_id", "=", run.id).execute();
    await db.updateTable("evidence_task_runs").set({
      status: "queued", canonical_result: null, failure_code: null, finished_at: null,
    }).where("id", "=", run.id).execute();
  }
  const nextCycle = investigation.reinvestigation_cycle_count + 1;
  await db.updateTable("investigations").set({ reinvestigation_cycle_count: nextCycle, updated_at: now }).where("id", "=", investigationId).execute();
  const event = PublicInvestigationEventSchema.parse({
    type: "reinvestigation_started", stage: "reinvestigating",
    payload: { cycle: nextCycle, taskKeys: [...taskKeys] },
  });
  await db.insertInto("investigation_events").values({
    investigation_id: investigationId, type: event.type, stage: event.stage,
    public_payload: JSON.stringify(event.payload), created_at: now,
  }).execute();
}
