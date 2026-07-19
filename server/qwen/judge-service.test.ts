import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/judge-readme.json";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "./errors";
import { InvestigationJudgeService } from "./judge-service";

const investigationId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const snapshot = {
  manifestHashSha256: "a".repeat(64), commitSha: "b".repeat(40), entries: [],
};

describe("investigation judge service", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("short-circuits when a persisted report already exists", async () => {
    const judgment = {
      findByInvestigation: vi.fn(async () => ({ id: "report", investigationId, artifact: fixture })),
      loadJudgeContext: vi.fn(),
      createForInvestigation: vi.fn(),
    };
    const client = { createChatCompletion: vi.fn() };
    const result = await new InvestigationJudgeService(judgment as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).judge(investigationId);
    expect(result.investigationId).toBe(investigationId);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it("validates provider JSON and persists a schema-valid artifact", async () => {
    const judgment = {
      findByInvestigation: vi.fn(async () => null),
      loadJudgeContext: vi.fn(async () => ({
        investigationId,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot,
        skepticAnalysis: { id: "analysis", outcome: "cleared_for_judgment", artifact: {} },
        challenges: [],
        evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(async () => ({ id: "report", investigationId, artifact: fixture })),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(fixture) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      })),
    };
    await new InvestigationJudgeService(judgment as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).judge(investigationId, { attemptId: "3" });
    expect(judgment.createForInvestigation).toHaveBeenCalledWith(investigationId, expect.any(Object), expect.objectContaining({
      modelId: "qwen-plus", attemptId: "3",
    }));
  });

  it("rejects provider output without claim judgments", async () => {
    const judgment = {
      findByInvestigation: vi.fn(async () => null),
      loadJudgeContext: vi.fn(async () => ({
        investigationId,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot,
        skepticAnalysis: { id: "analysis", outcome: "cleared_for_judgment", artifact: {} },
        challenges: [],
        evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({ reportSummary: "Missing judgments." }) } }],
      })),
    };
    await expect(new InvestigationJudgeService(judgment as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).judge(investigationId)).rejects.toMatchObject({ failureCode: "judge_schema_invalid" });
    expect(judgment.createForInvestigation).not.toHaveBeenCalled();
  });

  it("derives completion disposition from verdicts instead of trusting the model", async () => {
    const judgment = {
      findByInvestigation: vi.fn(async () => null),
      loadJudgeContext: vi.fn(async () => ({
        investigationId,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot,
        skepticAnalysis: { id: "analysis", outcome: "cleared_for_judgment", artifact: {} },
        challenges: [],
        evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(async (_id, artifact) => ({ id: "report", investigationId, artifact })),
    };
    const verifiedFixture = {
      ...fixture,
      claimJudgments: [{ ...fixture.claimJudgments[0], claimId, verdict: "verified" }],
      limitations: [],
      maintainerActions: [],
      reportSummary: "Fully verified.",
      completionDisposition: "completed_with_limitations",
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(verifiedFixture) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      })),
    };
    await new InvestigationJudgeService(judgment as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).judge(investigationId);
    expect(judgment.createForInvestigation).toHaveBeenCalledWith(investigationId, expect.objectContaining({
      completionDisposition: "completed",
    }), expect.any(Object));
  });

  it("maps Zod schema failures to judge_schema_invalid", async () => {
    const judgment = {
      findByInvestigation: vi.fn(async () => null),
      loadJudgeContext: vi.fn(async () => ({
        investigationId,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot,
        skepticAnalysis: { id: "analysis", outcome: "cleared_for_judgment", artifact: {} },
        challenges: [],
        evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({ notAJudgeArtifact: true }) } }],
      })),
    };
    await expect(new InvestigationJudgeService(judgment as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).judge(investigationId)).rejects.toMatchObject({ failureCode: "judge_schema_invalid" });
  });

  it("rejects oversized judge context before calling the provider", async () => {
    vi.stubEnv("CERNIX_JUDGE_MAX_CONTEXT_BYTES", "4096");
    const judgment = {
      findByInvestigation: vi.fn(async () => null),
      loadJudgeContext: vi.fn(async () => ({
        investigationId,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot,
        skepticAnalysis: { id: "analysis", outcome: "cleared_for_judgment", artifact: {} },
        challenges: [],
        evidenceSummary: { tasks: [{ payload: "x".repeat(8_000) }] },
      })),
      createForInvestigation: vi.fn(),
    };
    const client = { createChatCompletion: vi.fn() };
    await expect(new InvestigationJudgeService(judgment as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).judge(investigationId)).rejects.toBeInstanceOf(PlanningError);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });
});
