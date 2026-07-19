import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/skeptic-readme.json";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "./errors";
import { InvestigationSkepticService } from "./skeptic-service";

const investigationId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const snapshot = {
  manifestHashSha256: "a".repeat(64), commitSha: "b".repeat(40), entries: [],
};

describe("investigation skeptic service", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("short-circuits when a persisted skeptic analysis already exists", async () => {
    const skeptic = {
      findByInvestigation: vi.fn(async () => ({ id: "analysis", investigationId, artifact: fixture })),
      loadSkepticContext: vi.fn(),
      createForInvestigation: vi.fn(),
    };
    const client = { createChatCompletion: vi.fn() };
    const result = await new InvestigationSkepticService(skeptic as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).analyze(investigationId);
    expect(result.investigationId).toBe(investigationId);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it("validates provider JSON and persists a schema-valid artifact", async () => {
    const skeptic = {
      findByInvestigation: vi.fn(async () => null),
      loadSkepticContext: vi.fn(async () => ({
        investigationId, reinvestigationCycle: 0,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot, evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(async () => ({ id: "analysis", investigationId, artifact: fixture })),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(fixture) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      })),
    };
    await new InvestigationSkepticService(skeptic as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).analyze(investigationId, { attemptId: "9" });
    expect(skeptic.createForInvestigation).toHaveBeenCalledWith(investigationId, expect.any(Object), expect.objectContaining({
      modelId: "qwen-plus", attemptId: "9",
    }));
  });

  it("rejects oversized evidence summaries before calling the provider", async () => {
    vi.stubEnv("CERNIX_SKEPTIC_MAX_CONTEXT_BYTES", "4096");
    const skeptic = {
      findByInvestigation: vi.fn(async () => null),
      loadSkepticContext: vi.fn(async () => ({
        investigationId, reinvestigationCycle: 0,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot, evidenceSummary: { tasks: [{ payload: "x".repeat(8_000) }] },
      })),
      createForInvestigation: vi.fn(),
    };
    const client = { createChatCompletion: vi.fn() };
    await expect(new InvestigationSkepticService(skeptic as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).analyze(investigationId)).rejects.toBeInstanceOf(PlanningError);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it("maps Zod schema failures to skeptic_schema_invalid", async () => {
    const skeptic = {
      findByInvestigation: vi.fn(async () => null),
      loadSkepticContext: vi.fn(async () => ({
        investigationId, reinvestigationCycle: 0,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot, evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({ challenges: [null] }) } }],
      })),
    };
    await expect(new InvestigationSkepticService(skeptic as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).analyze(investigationId)).rejects.toMatchObject({ failureCode: "skeptic_schema_invalid" });
  });

  it("maps persistence provenance failures to skeptic_schema_invalid", async () => {
    const skeptic = {
      findByInvestigation: vi.fn(async () => null),
      loadSkepticContext: vi.fn(async () => ({
        investigationId, reinvestigationCycle: 0,
        claim: { id: claimId, statement: "README exists.", preservedQualifiers: [] },
        obligations: [{ key: "obl_readme", description: "README exists." }],
        snapshot, evidenceSummary: { tasks: [] },
      })),
      createForInvestigation: vi.fn(async () => { throw new ApplicationError("malformed_input", {}); }),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(fixture) } }],
      })),
    };
    await expect(new InvestigationSkepticService(skeptic as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).analyze(investigationId)).rejects.toMatchObject({ failureCode: "skeptic_schema_invalid" });
  });
});
