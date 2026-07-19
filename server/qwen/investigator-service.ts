import { buildEvidenceTaskResultFromProviderResponse } from "./evidence-normalizer";
import type { EvidenceRepository, EvidenceTaskRun } from "@/server/persistence/evidence-repository";
import { ApplicationError } from "@/server/errors";
import type { QwenClient } from "./client";
import type { QwenPlanningConfig } from "./config";
import { PlanningError } from "./errors";
import { parseRetrievalConfig } from "@/server/evidence/retrieval-config";
import { retrieveFromSnapshot, retrievalBundleWithinLimit, serializeRetrievalBundle } from "@/server/evidence/retrieval-service";
import { buildInvestigatorSystemPrompt, buildInvestigatorUserPrompt, INVESTIGATOR_PROMPT_VERSION } from "./prompts/investigator-v1";

export type InvestigateTaskOptions = Readonly<{ signal?: AbortSignal; attemptId?: string }>;

export class RepositoryInvestigatorService {
  private readonly retrieval = parseRetrievalConfig();

  constructor(private readonly evidence: EvidenceRepository, private readonly client: QwenClient,
    private readonly config: QwenPlanningConfig) {}

  async investigateTask(runId: string, options?: InvestigateTaskOptions): Promise<EvidenceTaskRun> {
    const existing = await this.evidence.findTaskResultByRun(runId);
    if (existing) {
      const run = await this.evidence.loadTaskRun(runId);
      if (!run) throw new ApplicationError("not_found", {});
      return run;
    }
    const context = await this.evidence.loadInvestigatorContext(runId);
    if (!context) throw new ApplicationError("not_found", {});
    const { run } = context;
    if (run.status === "skipped_deferred") return run;
    if (run.status !== "queued") throw new ApplicationError("conflict", {});
    if (run.specialistCapability !== "repository_investigator") throw new ApplicationError("conflict", {});

    const bundle = retrieveFromSnapshot(context.snapshot, run.queryTerms, this.retrieval);
    if (!retrievalBundleWithinLimit(bundle, this.retrieval.maxContextBytes)) throw new PlanningError("evidence_context_invalid");
    const retrievalJson = serializeRetrievalBundle(bundle);
    const userPrompt = buildInvestigatorUserPrompt({
      claimId: context.run.claimId,
      claimStatement: context.claimStatement,
      obligationKeys: context.run.obligationKeys,
      obligationDescriptions: context.obligationDescriptions,
      taskKey: run.taskKey,
      expectedEvidenceTypes: run.expectedEvidenceTypes,
      retrievalJson,
    });
    if (Buffer.byteLength(userPrompt, "utf8") > this.retrieval.maxContextBytes) throw new PlanningError("evidence_context_invalid");
    const deadline = AbortSignal.timeout(this.config.planningDeadlineMs);
    const composed = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const response = await this.client.createChatCompletion({
      model: this.config.modelId,
      messages: [
        { role: "system", content: buildInvestigatorSystemPrompt() },
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
      artifact = buildEvidenceTaskResultFromProviderResponse({
        parsed,
        taskKey: run.taskKey,
        claimId: run.claimId,
        obligationKeys: run.obligationKeys,
        retrievalMatches: bundle.matches,
      });
    } catch (error) {
      if (error instanceof PlanningError) throw error;
      throw new PlanningError("evidence_schema_invalid", error);
    }
    try {
      await this.evidence.persistTaskResult(run.id, artifact, {
        modelId: this.config.modelId,
        promptVersion: INVESTIGATOR_PROMPT_VERSION,
        attemptId: options?.attemptId ?? null,
        inputTokenEstimate: response.usage?.prompt_tokens ?? null,
        outputTokenEstimate: response.usage?.completion_tokens ?? null,
      });
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "malformed_input") {
        throw new PlanningError("evidence_schema_invalid", error);
      }
      throw error;
    }
    const updated = await this.evidence.loadTaskRun(run.id);
    if (!updated) throw new ApplicationError("internal_error", {});
    return updated;
  }
}
