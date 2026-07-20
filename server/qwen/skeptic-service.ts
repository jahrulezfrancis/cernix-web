import type { SkepticRepository, PersistedSkepticAnalysis } from "@/server/persistence/skeptic-repository";
import { ApplicationError } from "@/server/errors";
import {
  buildProvenanceFromEvidenceSummary,
  sanitizeSkepticArtifactForProvenance,
} from "@/server/skeptic/challenge-provenance";
import type { QwenClient } from "./client";
import type { QwenPlanningConfig } from "./config";
import { PlanningError } from "./errors";
import { buildSkepticArtifactFromProviderResponse } from "./skeptic-normalizer";
import { parseSkepticContextConfig } from "@/server/skeptic/skeptic-config";
import { buildSkepticSystemPrompt, buildSkepticUserPrompt, SKEPTIC_PROMPT_VERSION } from "./prompts/skeptic-v1";

export type AnalyzeInvestigationOptions = Readonly<{ signal?: AbortSignal; attemptId?: string }>;

export class InvestigationSkepticService {
  private readonly contextConfig = parseSkepticContextConfig();

  constructor(private readonly skeptic: SkepticRepository, private readonly client: QwenClient,
    private readonly config: QwenPlanningConfig) {}

  async analyze(investigationId: string, options?: AnalyzeInvestigationOptions): Promise<PersistedSkepticAnalysis> {
    const existing = await this.skeptic.findByInvestigation(investigationId);
    if (existing) return existing;
    const context = await this.skeptic.loadSkepticContext(investigationId);
    if (!context) throw new ApplicationError("not_found", {});
    const evidenceJson = JSON.stringify(context.evidenceSummary);
    if (Buffer.byteLength(evidenceJson, "utf8") > this.contextConfig.maxContextBytes) {
      throw new PlanningError("skeptic_context_invalid");
    }
    const userPrompt = buildSkepticUserPrompt({
      claimId: context.claim.id,
      claimStatement: context.claim.statement,
      preservedQualifiers: context.claim.preservedQualifiers,
      obligations: context.obligations,
      evidenceJson,
      reinvestigationCycle: context.reinvestigationCycle,
    });
    if (Buffer.byteLength(userPrompt, "utf8") > this.contextConfig.maxContextBytes) throw new PlanningError("skeptic_context_invalid");
    const deadline = AbortSignal.timeout(this.config.planningDeadlineMs);
    const composed = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const response = await this.client.createChatCompletion({
      model: this.config.modelId,
      messages: [
        { role: "system", content: buildSkepticSystemPrompt() },
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
    let artifact;
    try {
      artifact = buildSkepticArtifactFromProviderResponse({
        parsed,
        investigationId,
        claimId: context.claim.id,
        snapshotManifestHash: context.snapshot.manifestHashSha256,
        commitSha: context.snapshot.commitSha,
      });
      const provenance = buildProvenanceFromEvidenceSummary(context.evidenceSummary);
      artifact = sanitizeSkepticArtifactForProvenance(artifact, provenance.index, provenance.taskRuns);
    } catch (error) {
      if (error instanceof PlanningError) throw error;
      throw new PlanningError("skeptic_schema_invalid", error);
    }
    try {
      return await this.skeptic.createForInvestigation(investigationId, artifact, {
        modelId: this.config.modelId,
        promptVersion: SKEPTIC_PROMPT_VERSION,
        attemptId: options?.attemptId ?? null,
        inputTokenEstimate: response.usage?.prompt_tokens ?? null,
        outputTokenEstimate: response.usage?.completion_tokens ?? null,
      });
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "malformed_input") {
        throw new PlanningError("skeptic_schema_invalid", error);
      }
      throw error;
    }
  }
}
