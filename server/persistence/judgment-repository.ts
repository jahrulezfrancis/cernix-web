import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import {
  JudgeArtifactSchema,
  hashJudgeArtifact,
  validateJudgeArtifact,
  type JudgeArtifact,
} from "@/lib/contracts/judgment-report";
import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { ApplicationError } from "@/server/errors";
import { loadPersistedPlan } from "./investigation-plan-repository";
import { loadPersistedSnapshot } from "./repository-snapshot-repository";
import { loadPersistedSkepticAnalysis } from "./skeptic-repository";
import { PublicInvestigationEventSchema } from "./events";
import { validateJudgeClaimCoverage } from "@/server/judge/judge-provenance";
import { verifyPersistedReportArtifact } from "@/server/judge/report-replay";
import { loadInvestigationEvidenceBundle } from "@/server/report/investigation-evidence-bundle";

export type PersistedInvestigationReport = Readonly<{
  id: string;
  investigationId: string;
  completionDisposition: JudgeArtifact["completionDisposition"];
  artifactHashSha256: string;
  artifact: JudgeArtifact;
}>;

type Db = Kysely<Database> | Transaction<Database>;

export async function loadPersistedReport(db: Db, investigationId: string): Promise<PersistedInvestigationReport | null> {
  const row = await db.selectFrom("investigation_reports").selectAll().where("investigation_id", "=", investigationId).executeTakeFirst();
  if (!row) return null;
  const artifact = verifyPersistedReportArtifact(row);
  return {
    id: row.id, investigationId: row.investigation_id, completionDisposition: row.completion_disposition,
    artifactHashSha256: row.artifact_hash_sha256, artifact,
  };
}

export async function isReportComplete(db: Db, investigationId: string): Promise<boolean> {
  return Boolean(await loadPersistedReport(db, investigationId));
}

async function buildEvidenceSummary(db: Db, investigationId: string): Promise<unknown> {
  return loadInvestigationEvidenceBundle(db, investigationId);
}

export class JudgmentRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID) {}

  async findByInvestigation(rawInvestigationId: unknown): Promise<PersistedInvestigationReport | null> {
    const investigationId = InvestigationIdSchema.parse(rawInvestigationId);
    try {
      return await loadPersistedReport(this.db, investigationId);
    } catch (error) { throw classifyDatabaseError(error); }
  }

  async loadJudgeContext(investigationId: string): Promise<Readonly<{
    investigationId: string;
    claim: Readonly<{ id: string; statement: string; preservedQualifiers: string[] }>;
    obligations: readonly Readonly<{ key: string; description: string }>[];
    snapshot: NonNullable<Awaited<ReturnType<typeof loadPersistedSnapshot>>>;
    skepticAnalysis: NonNullable<Awaited<ReturnType<typeof loadPersistedSkepticAnalysis>>>;
    challenges: readonly Readonly<{
      id: string; challengeType: string; severity: string; summary: string; reasoning: string;
      disposition: string; resolutionNote: string;
    }>[];
    evidenceSummary: unknown;
  }> | null> {
    const claim = await this.db.selectFrom("manual_claims").select(["id", "statement", "preserved_qualifiers"])
      .where("investigation_id", "=", investigationId).executeTakeFirst();
    if (!claim) return null;
    const snapshot = await loadPersistedSnapshot(this.db, investigationId);
    if (!snapshot) throw new ApplicationError("conflict", {});
    const skepticAnalysis = await loadPersistedSkepticAnalysis(this.db, investigationId);
    if (!skepticAnalysis) throw new ApplicationError("conflict", {});
    const obligations = await this.db.selectFrom("verification_obligations").select(["obligation_key", "description"])
      .innerJoin("investigation_plans", "investigation_plans.id", "verification_obligations.plan_id")
      .where("investigation_plans.investigation_id", "=", investigationId).execute();
    const challengeRows = await this.db.selectFrom("skeptic_challenges")
      .innerJoin("challenge_resolutions", "challenge_resolutions.challenge_id", "skeptic_challenges.id")
      .select([
        "skeptic_challenges.challenge_key as challenge_key",
        "skeptic_challenges.challenge_type as challenge_type",
        "skeptic_challenges.severity as severity",
        "skeptic_challenges.summary as summary",
        "skeptic_challenges.reasoning as reasoning",
        "challenge_resolutions.disposition as disposition",
        "challenge_resolutions.resolution_note as resolution_note",
      ])
      .where("skeptic_challenges.investigation_id", "=", investigationId)
      .where("skeptic_challenges.analysis_id", "=", skepticAnalysis.id)
      .execute();
    return {
      investigationId,
      claim: {
        id: claim.id, statement: claim.statement,
        preservedQualifiers: Array.isArray(claim.preserved_qualifiers) ? claim.preserved_qualifiers as string[] : JSON.parse(String(claim.preserved_qualifiers)),
      },
      obligations: obligations.map((row) => ({ key: row.obligation_key, description: row.description })),
      snapshot,
      skepticAnalysis,
      challenges: challengeRows.map((row) => ({
        id: row.challenge_key, challengeType: row.challenge_type, severity: row.severity,
        summary: row.summary, reasoning: row.reasoning, disposition: row.disposition, resolutionNote: row.resolution_note,
      })),
      evidenceSummary: await buildEvidenceSummary(this.db, investigationId),
    };
  }

  async createForInvestigation(investigationId: string, artifact: JudgeArtifact, modelMeta: Readonly<{
    modelId: string; promptVersion: string; attemptId?: string | null;
    inputTokenEstimate?: number | null; outputTokenEstimate?: number | null;
  }>): Promise<PersistedInvestigationReport> {
    const parsed = validateJudgeArtifact(artifact);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const existing = await loadPersistedReport(tx, investigationId);
        if (existing) return existing;
        const plan = await loadPersistedPlan(tx, investigationId);
        if (!plan) throw new ApplicationError("conflict", {});
        const snapshot = await loadPersistedSnapshot(tx, investigationId);
        if (!snapshot) throw new ApplicationError("conflict", {});
        const skepticAnalysis = await loadPersistedSkepticAnalysis(tx, investigationId);
        if (!skepticAnalysis) throw new ApplicationError("conflict", {});
        if (parsed.snapshotManifestHash !== snapshot.manifestHashSha256 || parsed.commitSha !== snapshot.commitSha) {
          throw new ApplicationError("malformed_input", {});
        }
        const claims = await tx.selectFrom("manual_claims").select("id").where("investigation_id", "=", investigationId).execute();
        validateJudgeClaimCoverage(parsed, claims.map((claim) => claim.id));
        const artifactHash = hashJudgeArtifact(parsed);
        const now = this.clock();
        const reportId = this.id();
        const primaryClaimId = claims[0]?.id;
        if (!primaryClaimId) throw new ApplicationError("conflict", {});
        await tx.insertInto("investigation_reports").values({
          id: reportId, investigation_id: investigationId, plan_id: plan.id, snapshot_id: snapshot.id,
          skeptic_analysis_id: skepticAnalysis.id, claim_id: primaryClaimId,
          manifest_hash_sha256: snapshot.manifestHashSha256, commit_sha: snapshot.commitSha,
          schema_version: parsed.schemaVersion, model_id: modelMeta.modelId, prompt_version: modelMeta.promptVersion,
          completion_disposition: parsed.completionDisposition, report_summary: parsed.reportSummary,
          artifact_hash_sha256: artifactHash, canonical_artifact: JSON.stringify(parsed), judgment_count: parsed.claimJudgments.length,
          created_at: now,
        }).execute();
        for (const judgment of parsed.claimJudgments) {
          await tx.insertInto("claim_judgments").values({
            id: this.id(), report_id: reportId, investigation_id: investigationId, claim_id: judgment.claimId,
            judgment_key: judgment.id, verdict: judgment.verdict, confidence: judgment.confidence,
            summary: judgment.summary, reasoning: judgment.reasoning,
            confidence_factors: JSON.stringify(judgment.confidenceFactors),
            unproven_aspects: JSON.stringify(judgment.unprovenAspects),
            what_could_change_verdict: JSON.stringify(judgment.whatCouldChangeVerdict),
            created_at: now,
          }).execute();
        }
        for (const limitation of parsed.limitations) {
          await tx.insertInto("report_limitations").values({
            id: this.id(), report_id: reportId, investigation_id: investigationId, claim_id: limitation.claimId,
            limitation_key: limitation.id, description: limitation.description, impact: limitation.impact, created_at: now,
          }).execute();
        }
        for (const action of parsed.maintainerActions) {
          await tx.insertInto("maintainer_actions").values({
            id: this.id(), report_id: reportId, investigation_id: investigationId, claim_id: action.claimId,
            action_key: action.id, action_text: action.action, priority: action.priority, created_at: now,
          }).execute();
        }
        const event = PublicInvestigationEventSchema.parse({
          type: "investigation_report_persisted", stage: parsed.completionDisposition,
          payload: {
            reportId, completionDisposition: parsed.completionDisposition, judgmentCount: parsed.claimJudgments.length,
            schemaVersion: 1, modelId: modelMeta.modelId, promptVersion: modelMeta.promptVersion,
            artifactHashSha256: artifactHash,
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
        return {
          id: reportId, investigationId, completionDisposition: parsed.completionDisposition,
          artifactHashSha256: artifactHash, artifact: parsed,
        };
      });
    } catch (error) { throw classifyDatabaseError(error); }
  }
}

export async function replayPersistedReport(db: Db, investigationId: string): Promise<PersistedInvestigationReport> {
  const report = await loadPersistedReport(db, investigationId);
  if (!report) throw new ApplicationError("not_found", {});
  const stored = await db.selectFrom("investigation_reports").selectAll().where("investigation_id", "=", investigationId).executeTakeFirstOrThrow();
  const judgments = await db.selectFrom("claim_judgments").selectAll().where("report_id", "=", stored.id).execute();
  if (judgments.length !== report.artifact.claimJudgments.length) throw new ApplicationError("internal_error", {});
  const artifact = JudgeArtifactSchema.parse(report.artifact);
  if (hashJudgeArtifact(artifact) !== stored.artifact_hash_sha256) throw new ApplicationError("internal_error", {});
  return report;
}
