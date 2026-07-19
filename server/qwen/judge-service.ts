import type { JudgmentRepository, PersistedInvestigationReport } from "@/server/persistence/judgment-repository";
import { ApplicationError } from "@/server/errors";
import type { QwenClient } from "./client";
import type { QwenPlanningConfig } from "./config";
import { PlanningError } from "./errors";
import { buildJudgeArtifactFromProviderResponse } from "./judge-normalizer";
import { parseJudgeContextConfig } from "@/server/judge/judge-config";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt, JUDGE_PROMPT_VERSION } from "./prompts/judge-v1";

export type JudgeInvestigationOptions = Readonly<{ signal?: AbortSignal; attemptId?: string }>;

export class InvestigationJudgeService {
  private readonly contextConfig = parseJudgeContextConfig();

  constructor(private readonly judgment: JudgmentRepository, private readonly client: QwenClient,
    private readonly config: QwenPlanningConfig) {}

  async judge(investigationId: string, options?: JudgeInvestigationOptions): Promise<PersistedInvestigationReport> {
    const existing = await this.judgment.findByInvestigation(investigationId);
    if (existing) return existing;
    const context = await this.judgment.loadJudgeContext(investigationId);
    if (!context) throw new ApplicationError("not_found", {});
    const evidenceJson = JSON.stringify(context.evidenceSummary);
    const challengesJson = JSON.stringify(context.challenges);
    if (Buffer.byteLength(evidenceJson, "utf8") + Buffer.byteLength(challengesJson, "utf8") > this.contextConfig.maxContextBytes) {
      throw new PlanningError("judge_context_invalid");
    }
    const userPrompt = buildJudgeUserPrompt({
      claimId: context.claim.id,
      claimStatement: context.claim.statement,
      preservedQualifiers: context.claim.preservedQualifiers,
      obligations: context.obligations,
      skepticOutcome: context.skepticAnalysis.outcome,
      challengesJson,
      evidenceJson,
    });
    if (Buffer.byteLength(userPrompt, "utf8") > this.contextConfig.maxContextBytes) throw new PlanningError("judge_context_invalid");
    const deadline = AbortSignal.timeout(this.config.planningDeadlineMs);
    const composed = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const response = await this.client.createChatCompletion({
      model: this.config.modelId,
      messages: [
        { role: "system", content: buildJudgeSystemPrompt() },
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
      artifact = buildJudgeArtifactFromProviderResponse({
        parsed,
        investigationId,
        claimId: context.claim.id,
        snapshotManifestHash: context.snapshot.manifestHashSha256,
        commitSha: context.snapshot.commitSha,
      });
    } catch (error) {
      if (error instanceof PlanningError) throw error;
      throw new PlanningError("judge_schema_invalid", error);
    }
    try {
      return await this.judgment.createForInvestigation(investigationId, artifact, {
        modelId: this.config.modelId,
        promptVersion: JUDGE_PROMPT_VERSION,
        attemptId: options?.attemptId ?? null,
        inputTokenEstimate: response.usage?.prompt_tokens ?? null,
        outputTokenEstimate: response.usage?.completion_tokens ?? null,
      });
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "malformed_input") {
        throw new PlanningError("judge_schema_invalid", error);
      }
      throw error;
    }
  }
}
