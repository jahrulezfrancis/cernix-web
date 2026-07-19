import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import {
  InvestigationPlanArtifactSchema,
  PLAN_SCHEMA_VERSION,
  type InvestigationPlanArtifact,
} from "@/lib/contracts/investigation-plan";
import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import { loadPersistedSnapshot } from "./repository-snapshot-repository";
import { PublicInvestigationEventSchema } from "./events";

export type PersistedInvestigationPlan = Readonly<{
  id: string;
  investigationId: string;
  snapshotId: string;
  manifestHashSha256: string;
  commitSha: string;
  schemaVersion: number;
  modelId: string;
  promptVersion: string;
  obligationCount: number;
  taskCount: number;
  createdAt: Date;
  artifact: InvestigationPlanArtifact;
}>;

export type PlanningContext = Readonly<{
  investigationId: string;
  status: string;
  claim: Readonly<{ id: string; statement: string; preservedQualifiers: string[] }>;
  snapshot: NonNullable<Awaited<ReturnType<typeof loadPersistedSnapshot>>>;
}>;

type Clock = () => Date;
type IdGenerator = () => string;

export function isPlanWinnerConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505" &&
    "constraint" in error && error.constraint === "investigation_plans_investigation_unique");
}

export async function loadPersistedPlan(db: Kysely<Database> | Transaction<Database>, investigationId: string): Promise<PersistedInvestigationPlan | null> {
  const row = await db.selectFrom("investigation_plans").selectAll().where("investigation_id", "=", investigationId).executeTakeFirst();
  if (!row) return null;
  const artifact = InvestigationPlanArtifactSchema.parse(
    typeof row.canonical_plan === "string" ? JSON.parse(row.canonical_plan) : row.canonical_plan,
  );
  if (artifact.investigationId !== investigationId || artifact.snapshotManifestHash !== row.manifest_hash_sha256 ||
      artifact.commitSha !== row.commit_sha || artifact.schemaVersion !== row.schema_version) {
    throw new ApplicationError("internal_error", {});
  }
  return {
    id: row.id, investigationId: row.investigation_id, snapshotId: row.snapshot_id,
    manifestHashSha256: row.manifest_hash_sha256, commitSha: row.commit_sha,
    schemaVersion: row.schema_version, modelId: row.model_id, promptVersion: row.prompt_version,
    obligationCount: row.obligation_count, taskCount: row.task_count, createdAt: row.created_at, artifact,
  };
}

export class InvestigationPlanRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: () => Date = () => new Date(),
    private readonly id: IdGenerator = randomUUID) {}

  async loadPlanningContext(rawId: unknown): Promise<PlanningContext> {
    const investigationId = InvestigationIdSchema.parse(rawId);
    try {
      const row = await this.db.selectFrom("investigations").innerJoin("manual_claims", "manual_claims.investigation_id", "investigations.id")
        .select(["investigations.id", "status", "manual_claims.id as claim_id", "statement", "preserved_qualifiers"])
        .where("investigations.id", "=", investigationId).executeTakeFirst();
      if (!row) throw new ApplicationError("not_found", {});
      const snapshot = await loadPersistedSnapshot(this.db, investigationId);
      if (!snapshot) throw new ApplicationError("conflict", {});
      return {
        investigationId: row.id, status: row.status,
        claim: { id: row.claim_id, statement: row.statement, preservedQualifiers: row.preserved_qualifiers },
        snapshot,
      };
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async findByInvestigation(rawId: unknown): Promise<PersistedInvestigationPlan | null> {
    const investigationId = InvestigationIdSchema.parse(rawId);
    try { return await loadPersistedPlan(this.db, investigationId); }
    catch (error) { throw classifyDatabaseError(error); }
  }

  async isPlanComplete(rawId: unknown): Promise<boolean> {
    const plan = await this.findByInvestigation(rawId);
    if (!plan) return false;
    const claims = await this.db.selectFrom("manual_claims").select("id").where("investigation_id", "=", plan.investigationId).execute();
    const claimIds = new Set(claims.map((claim) => claim.id));
    for (const claimPlan of plan.artifact.claimPlans) {
      if (!claimIds.has(claimPlan.claimId)) return false;
      if (claimPlan.obligations.length < 1 || claimPlan.evidenceTasks.length < 1) return false;
    }
    return plan.artifact.claimPlans.length === claimIds.size;
  }

  async createForInvestigation(rawId: unknown, artifact: InvestigationPlanArtifact, modelMeta: Readonly<{
    modelId: string; promptVersion: string; attemptId?: string | null;
    inputTokenEstimate?: number | null; outputTokenEstimate?: number | null;
  }>): Promise<PersistedInvestigationPlan> {
    const investigationId = InvestigationIdSchema.parse(rawId);
    const parsed = InvestigationPlanArtifactSchema.parse(artifact);
    if (parsed.investigationId !== investigationId) throw new ApplicationError("malformed_input", {});
    try {
      return await this.db.transaction().execute(async (tx) => {
        const investigation = await tx.selectFrom("investigations").select(["id", "status"])
          .where("id", "=", investigationId).forUpdate().executeTakeFirst();
        if (!investigation) throw new ApplicationError("not_found", {});
        const existing = await loadPersistedPlan(tx, investigationId);
        if (existing) return existing;
        if (investigation.status !== "planning") throw new ApplicationError("invalid_lifecycle_transition", {});
        const snapshot = await loadPersistedSnapshot(tx, investigationId);
        if (!snapshot || snapshot.manifestHashSha256 !== parsed.snapshotManifestHash || snapshot.commitSha !== parsed.commitSha) {
          throw new ApplicationError("conflict", {});
        }
        const claims = await tx.selectFrom("manual_claims").select(["id"]).where("investigation_id", "=", investigationId).execute();
        const claimIds = new Set(claims.map((claim) => claim.id));
        if (parsed.claimPlans.length !== claimIds.size || parsed.claimPlans.some((plan) => !claimIds.has(plan.claimId))) {
          throw new ApplicationError("malformed_input", {});
        }
        const now = this.clock(), planId = this.id();
        let obligationCount = 0, taskCount = 0;
        for (const claimPlan of parsed.claimPlans) {
          obligationCount += claimPlan.obligations.length;
          taskCount += claimPlan.evidenceTasks.length;
        }
        await tx.insertInto("investigation_plans").values({
          id: planId, investigation_id: investigationId, snapshot_id: snapshot.id,
          manifest_hash_sha256: parsed.snapshotManifestHash, commit_sha: parsed.commitSha,
          schema_version: PLAN_SCHEMA_VERSION, model_id: modelMeta.modelId, prompt_version: modelMeta.promptVersion,
          canonical_plan: JSON.stringify(parsed), obligation_count: obligationCount, task_count: taskCount, created_at: now,
        }).execute();
        for (const claimPlan of parsed.claimPlans) {
          const obligationIdByKey = new Map<string, string>();
          for (const obligation of claimPlan.obligations) {
            const obligationId = this.id();
            obligationIdByKey.set(obligation.id, obligationId);
            await tx.insertInto("verification_obligations").values({
              id: obligationId, plan_id: planId, claim_id: claimPlan.claimId,
              obligation_key: obligation.id, description: obligation.description,
              taxonomy: obligation.taxonomy ?? null, priority: obligation.priority,
            }).execute();
          }
          for (const task of claimPlan.evidenceTasks) {
            const taskId = this.id();
            await tx.insertInto("evidence_tasks").values({
              id: taskId, plan_id: planId, claim_id: claimPlan.claimId, task_key: task.id,
              specialist_capability: task.specialistCapability,
              expected_evidence_types: JSON.stringify(task.expectedEvidenceTypes),
              query_terms: JSON.stringify(task.queryTerms),
              priority: task.priority,
              depends_on_task_ids: JSON.stringify(task.dependsOnTaskIds),
            }).execute();
            for (const obligationKey of task.obligationIds) {
              const obligationId = obligationIdByKey.get(obligationKey);
              if (!obligationId) throw new ApplicationError("internal_error", {});
              await tx.insertInto("evidence_task_obligations").values({ task_id: taskId, obligation_id: obligationId }).execute();
            }
          }
        }
        const event = PublicInvestigationEventSchema.parse({
          type: "investigation_plan_persisted", stage: "planning",
          payload: {
            planId, obligationCount, taskCount, schemaVersion: PLAN_SCHEMA_VERSION,
            modelId: modelMeta.modelId, promptVersion: modelMeta.promptVersion,
          },
        });
        await tx.insertInto("investigation_events").values({
          investigation_id: investigationId, type: event.type, stage: event.stage,
          public_payload: JSON.stringify(event.payload), created_at: now,
        }).execute();
        if (modelMeta.attemptId) {
          await tx.insertInto("model_invocations").values({
            plan_id: planId, attempt_id: modelMeta.attemptId, model_id: modelMeta.modelId,
            prompt_version: modelMeta.promptVersion, input_token_estimate: modelMeta.inputTokenEstimate ?? null,
            output_token_estimate: modelMeta.outputTokenEstimate ?? null, status: "succeeded", failure_code: null, created_at: now,
          }).execute();
        }
        const created = await loadPersistedPlan(tx, investigationId);
        if (!created) throw new ApplicationError("internal_error", {});
        return created;
      });
    } catch (error) {
      if (isPlanWinnerConflict(error)) {
        const winner = await this.findByInvestigation(investigationId);
        if (winner) return winner;
      }
      throw classifyDatabaseError(error);
    }
  }
}
