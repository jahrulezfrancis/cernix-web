import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import {
  PLAN_SCHEMA_VERSION,
  validateInvestigationPlanArtifact,
} from "@/lib/contracts/investigation-plan";
import type { InvestigationPlanRepository, PersistedInvestigationPlan } from "@/server/persistence/investigation-plan-repository";
import { ApplicationError } from "@/server/errors";
import type { QwenClient } from "./client";
import type { QwenPlanningConfig } from "./config";
import { PlanningError } from "./errors";
import { buildSnapshotPlanningSummary, serializeSnapshotPlanningSummary } from "./planning-context";
import { buildPlanningSystemPrompt, buildPlanningUserPrompt } from "./prompts/planning-v1";

export class InvestigationPlanningService {
  constructor(private readonly plans: InvestigationPlanRepository, private readonly client: QwenClient,
    private readonly config: QwenPlanningConfig) {}

  async generatePlan(investigationId: unknown, options?: Readonly<{ signal?: AbortSignal; attemptId?: string }>): Promise<PersistedInvestigationPlan> {
    const parsedId = InvestigationIdSchema.parse(investigationId);
    const signal = options?.signal;
    const existing = await this.plans.findByInvestigation(parsedId);
    if (existing) return existing;
    const context = await this.plans.loadPlanningContext(parsedId);
    if (context.status !== "planning") throw new ApplicationError("invalid_lifecycle_transition", {});
    const summary = buildSnapshotPlanningSummary(context.snapshot, this.config.maxContextBytes);
    const summaryJson = serializeSnapshotPlanningSummary(summary);
    if (Buffer.byteLength(summaryJson, "utf8") > this.config.maxContextBytes) throw new PlanningError("plan_context_invalid");
    const userPrompt = buildPlanningUserPrompt({
      claimStatement: context.claim.statement,
      preservedQualifiers: context.claim.preservedQualifiers,
      snapshotSummaryJson: summaryJson,
    });
    if (Buffer.byteLength(userPrompt, "utf8") > this.config.maxContextBytes) throw new PlanningError("plan_context_invalid");
    const deadline = AbortSignal.timeout(this.config.planningDeadlineMs);
    const composed = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const response = await this.client.createChatCompletion({
      model: this.config.modelId,
      messages: [
        { role: "system", content: buildPlanningSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: this.config.maxOutputTokens,
      temperature: 0,
    }, composed);
    const content = response.choices[0]?.message?.content;
    if (!content) throw new PlanningError("qwen_malformed_response");
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch (error) { throw new PlanningError("qwen_malformed_response", error); }
    const claimPlans = parsed && typeof parsed === "object" && "claimPlans" in parsed
      ? (parsed as { claimPlans: unknown }).claimPlans
      : parsed;
    const rawArtifact = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId: context.investigationId,
      snapshotManifestHash: context.snapshot.manifestHashSha256,
      commitSha: context.snapshot.commitSha,
      claimPlans: Array.isArray(claimPlans) ? claimPlans.map((plan) => {
        if (!plan || typeof plan !== "object") throw new PlanningError("plan_schema_invalid");
        return { ...(plan as object), claimId: (plan as { claimId?: string }).claimId ?? context.claim.id };
      }) : (() => { throw new PlanningError("plan_schema_invalid"); })(),
    };
    const artifact = validateInvestigationPlanArtifact(rawArtifact);
    return this.plans.createForInvestigation(context.investigationId, artifact, {
      modelId: this.config.modelId,
      promptVersion: this.config.promptVersion,
      attemptId: options?.attemptId ?? null,
      inputTokenEstimate: response.usage?.prompt_tokens ?? null,
      outputTokenEstimate: response.usage?.completion_tokens ?? null,
    });
  }
}
