import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import {
  EvidenceTaskResultSchema,
  type EvidenceTaskResult,
} from "@/lib/contracts/evidence-candidate";
import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import { loadPersistedPlan } from "./investigation-plan-repository";
import { loadPersistedSnapshot } from "./repository-snapshot-repository";
import { PublicInvestigationEventSchema } from "./events";
import { validateEvidenceExcerptProvenance } from "@/server/evidence/excerpt-provenance";

export type EvidenceTaskRunStatus = "queued" | "succeeded" | "failed" | "skipped_deferred";

export type EvidenceTaskRun = Readonly<{
  id: string;
  taskId: string;
  investigationId: string;
  claimId: string;
  taskKey: string;
  specialistCapability: string;
  status: EvidenceTaskRunStatus;
  queryTerms: string[];
  expectedEvidenceTypes: string[];
  dependsOnTaskKeys: string[];
  obligationKeys: string[];
}>;

type Db = Kysely<Database> | Transaction<Database>;
const REPOSITORY_INVESTIGATOR = "repository_investigator";
const TERMINAL = new Set<EvidenceTaskRunStatus>(["succeeded", "failed", "skipped_deferred"]);

export async function initializeTaskRunsForInvestigation(tx: Transaction<Database>, investigationId: string,
  now: Date, id: () => string): Promise<void> {
  const existing = await tx.selectFrom("evidence_task_runs").select("id")
    .where("investigation_id", "=", investigationId).executeTakeFirst();
  if (existing) return;
  const plan = await loadPersistedPlan(tx, investigationId);
  if (!plan) throw new ApplicationError("conflict", {});
  const tasks = await tx.selectFrom("evidence_tasks").selectAll().where("plan_id", "=", plan.id).execute();
  for (const task of tasks) {
    const deferred = task.specialist_capability !== REPOSITORY_INVESTIGATOR;
    await tx.insertInto("evidence_task_runs").values({
      id: id(), task_id: task.id, plan_id: plan.id, investigation_id: investigationId, claim_id: task.claim_id,
      task_key: task.task_key, specialist_capability: task.specialist_capability,
      status: deferred ? "skipped_deferred" : "queued",
      failure_code: deferred ? "capability_deferred" : null,
      canonical_result: null, created_at: now, finished_at: deferred ? now : null,
    }).execute();
  }
}

export async function isEvidenceCollectionComplete(db: Db, investigationId: string): Promise<boolean> {
  const runs = await db.selectFrom("evidence_task_runs").select("status").where("investigation_id", "=", investigationId).execute();
  return runs.length > 0 && runs.every((run) => TERMINAL.has(run.status as EvidenceTaskRunStatus));
}

export class EvidenceRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID) {}

  async loadTaskRun(runId: string): Promise<EvidenceTaskRun | null> {
    try {
      const row = await this.db.selectFrom("evidence_task_runs").innerJoin("evidence_tasks", "evidence_tasks.id", "evidence_task_runs.task_id")
        .select([
          "evidence_task_runs.id as id", "evidence_task_runs.task_id as task_id", "evidence_task_runs.investigation_id as investigation_id",
          "evidence_task_runs.claim_id as claim_id", "evidence_task_runs.task_key as task_key",
          "evidence_task_runs.specialist_capability as specialist_capability", "evidence_task_runs.status as status",
          "evidence_tasks.query_terms as query_terms", "evidence_tasks.expected_evidence_types as expected_evidence_types",
          "evidence_tasks.depends_on_task_ids as depends_on_task_ids",
        ]).where("evidence_task_runs.id", "=", runId).executeTakeFirst();
      if (!row) return null;
      const obligations = await this.db.selectFrom("evidence_task_obligations")
        .innerJoin("verification_obligations", "verification_obligations.id", "evidence_task_obligations.obligation_id")
        .select("verification_obligations.obligation_key as obligation_key")
        .where("evidence_task_obligations.task_id", "=", row.task_id).execute();
      return {
        id: row.id, taskId: row.task_id, investigationId: row.investigation_id, claimId: row.claim_id,
        taskKey: row.task_key, specialistCapability: row.specialist_capability, status: row.status as EvidenceTaskRunStatus,
        queryTerms: parseJsonArray(row.query_terms), expectedEvidenceTypes: parseJsonArray(row.expected_evidence_types),
        dependsOnTaskKeys: parseJsonArray(row.depends_on_task_ids),
        obligationKeys: obligations.map((item) => item.obligation_key),
      };
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async findTaskResultByRun(runId: string): Promise<EvidenceTaskResult | null> {
    try {
      const row = await this.db.selectFrom("evidence_task_runs").select(["status", "canonical_result"])
        .where("id", "=", runId).executeTakeFirst();
      if (!row || row.status !== "succeeded" || !row.canonical_result) return null;
      return EvidenceTaskResultSchema.parse(typeof row.canonical_result === "string" ? JSON.parse(row.canonical_result) : row.canonical_result);
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async getNextRunnableTaskRun(rawInvestigationId: unknown): Promise<EvidenceTaskRun | null> {
    const investigationId = InvestigationIdSchema.parse(rawInvestigationId);
    try {
      const runs = await this.db.selectFrom("evidence_task_runs").innerJoin("evidence_tasks", "evidence_tasks.id", "evidence_task_runs.task_id")
        .select([
          "evidence_task_runs.id as id", "evidence_task_runs.task_id as task_id", "evidence_task_runs.investigation_id as investigation_id",
          "evidence_task_runs.claim_id as claim_id", "evidence_task_runs.task_key as task_key",
          "evidence_task_runs.specialist_capability as specialist_capability", "evidence_task_runs.status as status",
          "evidence_tasks.query_terms as query_terms", "evidence_tasks.expected_evidence_types as expected_evidence_types",
          "evidence_tasks.depends_on_task_ids as depends_on_task_ids", "evidence_tasks.priority as priority",
        ]).where("evidence_task_runs.investigation_id", "=", investigationId).where("evidence_task_runs.status", "=", "queued")
        .orderBy("evidence_tasks.priority").orderBy("evidence_task_runs.task_key").execute();
      const statuses = new Map((await this.db.selectFrom("evidence_task_runs").select(["task_key", "status"])
        .where("investigation_id", "=", investigationId).execute()).map((row) => [row.task_key, row.status as EvidenceTaskRunStatus]));
      for (const row of runs) {
        const deps = parseJsonArray(row.depends_on_task_ids);
        if (deps.every((key) => {
          const status = statuses.get(key);
          return status === "succeeded" || status === "skipped_deferred";
        })) {
          const obligations = await this.db.selectFrom("evidence_task_obligations")
            .innerJoin("verification_obligations", "verification_obligations.id", "evidence_task_obligations.obligation_id")
            .select("verification_obligations.obligation_key as obligation_key")
            .where("evidence_task_obligations.task_id", "=", row.task_id).execute();
          return {
            id: row.id, taskId: row.task_id, investigationId: row.investigation_id, claimId: row.claim_id,
            taskKey: row.task_key, specialistCapability: row.specialist_capability, status: row.status as EvidenceTaskRunStatus,
            queryTerms: parseJsonArray(row.query_terms), expectedEvidenceTypes: parseJsonArray(row.expected_evidence_types),
            dependsOnTaskKeys: deps, obligationKeys: obligations.map((item) => item.obligation_key),
          };
        }
      }
      return null;
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async persistTaskResult(runId: string, result: EvidenceTaskResult, modelMeta: Readonly<{
    modelId: string; promptVersion: string; attemptId?: string | null;
    inputTokenEstimate?: number | null; outputTokenEstimate?: number | null;
  }>): Promise<EvidenceTaskResult> {
    const parsed = EvidenceTaskResultSchema.parse(result);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const run = await tx.selectFrom("evidence_task_runs").selectAll().where("id", "=", runId).forUpdate().executeTakeFirst();
        if (!run) throw new ApplicationError("not_found", {});
        if (run.status === "succeeded" && run.canonical_result) {
          return EvidenceTaskResultSchema.parse(typeof run.canonical_result === "string" ? JSON.parse(run.canonical_result) : run.canonical_result);
        }
        if (run.status !== "queued") throw new ApplicationError("conflict", {});
        if (parsed.taskKey !== run.task_key) throw new ApplicationError("malformed_input", {});
        const snapshot = await loadPersistedSnapshot(tx, run.investigation_id);
        if (!snapshot) throw new ApplicationError("conflict", {});
        validateEvidenceExcerptProvenance(parsed, snapshot);
        const now = this.clock();
        await tx.updateTable("evidence_task_runs").set({
          status: "succeeded", canonical_result: JSON.stringify(parsed), finished_at: now, failure_code: null,
        }).where("id", "=", runId).execute();
        for (const candidate of parsed.candidates) {
          const candidateId = this.id();
          await tx.insertInto("evidence_candidates").values({
            id: candidateId, run_id: runId, investigation_id: run.investigation_id, claim_id: run.claim_id,
            snapshot_id: snapshot.id, candidate_key: candidate.id, evidence_type: candidate.evidenceType,
            observation: candidate.observation, strength: candidate.strength,
            manifest_hash_sha256: snapshot.manifestHashSha256, commit_sha: snapshot.commitSha, created_at: now,
          }).execute();
          for (const excerpt of candidate.excerpts) {
            await tx.insertInto("evidence_excerpts").values({
              id: this.id(), candidate_id: candidateId, path: excerpt.path, line_start: excerpt.lineStart,
              line_end: excerpt.lineEnd, normalized_sha256: excerpt.normalizedSha256, excerpt_text: excerpt.excerptText,
            }).execute();
          }
        }
        for (const gap of parsed.gaps) {
          await tx.insertInto("evidence_gaps").values({
            id: this.id(), run_id: runId, gap_key: gap.id, description: gap.description, impact: gap.impact,
          }).execute();
        }
        for (const counter of parsed.counterevidence) {
          await tx.insertInto("counterevidence_items").values({
            id: this.id(), run_id: runId, counter_key: counter.id,
            related_candidate_key: counter.relatedCandidateId ?? null,
            description: counter.description, severity: counter.severity,
          }).execute();
        }
        const event = PublicInvestigationEventSchema.parse({
          type: "evidence_task_completed", stage: "investigating",
          payload: {
            runId, taskKey: run.task_key, candidateCount: parsed.candidates.length,
            gapCount: parsed.gaps.length, counterCount: parsed.counterevidence.length,
          },
        });
        await tx.insertInto("investigation_events").values({
          investigation_id: run.investigation_id, type: event.type, stage: event.stage,
          public_payload: JSON.stringify(event.payload), created_at: now,
        }).execute();
        if (modelMeta.attemptId) {
          await tx.insertInto("model_invocations").values({
            plan_id: run.plan_id, attempt_id: modelMeta.attemptId, model_id: modelMeta.modelId,
            prompt_version: modelMeta.promptVersion, input_token_estimate: modelMeta.inputTokenEstimate ?? null,
            output_token_estimate: modelMeta.outputTokenEstimate ?? null, status: "succeeded", failure_code: null, created_at: now,
          }).execute();
        }
        return parsed;
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async markTaskRunFailed(runId: string, failureCode: string): Promise<void> {
    const now = this.clock();
    await this.db.updateTable("evidence_task_runs").set({
      status: "failed", failure_code: failureCode, finished_at: now,
    }).where("id", "=", runId).where("status", "=", "queued").execute();
  }

  async isCollectionComplete(investigationId: string): Promise<boolean> {
    return isEvidenceCollectionComplete(this.db, investigationId);
  }

  async loadInvestigatorContext(runId: string): Promise<Readonly<{
    run: EvidenceTaskRun;
    claimStatement: string;
    obligationDescriptions: readonly string[];
    snapshot: NonNullable<Awaited<ReturnType<typeof loadPersistedSnapshot>>>;
  }> | null> {
    const run = await this.loadTaskRun(runId);
    if (!run) return null;
    const snapshot = await loadPersistedSnapshot(this.db, run.investigationId);
    if (!snapshot) throw new ApplicationError("conflict", {});
    const claim = await this.db.selectFrom("manual_claims").select("statement").where("id", "=", run.claimId).executeTakeFirst();
    if (!claim) throw new ApplicationError("not_found", {});
    const obligations = await this.db.selectFrom("verification_obligations").select("description")
      .innerJoin("evidence_task_obligations", "evidence_task_obligations.obligation_id", "verification_obligations.id")
      .where("evidence_task_obligations.task_id", "=", run.taskId).execute();
    return {
      run, claimStatement: claim.statement,
      obligationDescriptions: obligations.map((row) => row.description),
      snapshot,
    };
  }
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return JSON.parse(value) as string[];
  return [];
}
