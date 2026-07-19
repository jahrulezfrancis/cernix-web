import { describe, expect, it, vi } from "vitest";
import { PLAN_SCHEMA_VERSION } from "@/lib/contracts/investigation-plan";
import { InvestigationPlanRepository } from "@/server/persistence/investigation-plan-repository";
import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { QwenClient } from "./client";
import { InvestigationPlanningService } from "./planning-service";

const investigationId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const snapshot = {
  manifestHashSha256: "a".repeat(64), commitSha: "b".repeat(40), entries: [],
  inspectedEntryCount: 0, admittedFileCount: 0, excludedEntryCount: 0, totalAdmittedBytes: "0",
} as unknown as PersistedRepositorySnapshot;

const validResponse = {
  claimPlans: [{
    claimId,
    obligations: [{ id: "obl_guard", claimId, description: "Guard exists.", taxonomy: "security_control", priority: 1 }],
    evidenceTasks: [{
      id: "task_scan", obligationIds: ["obl_guard"], specialistCapability: "repository_investigator",
      expectedEvidenceTypes: ["code_implementation"], queryTerms: ["auth"], priority: 1, dependsOnTaskIds: [],
    }],
    knownLimitations: ["Static inspection only."],
  }],
};

describe("investigation planning service", () => {
  it("short-circuits when a persisted plan already exists", async () => {
    const existing = { id: "plan-1", investigationId } as Awaited<ReturnType<InvestigationPlanRepository["findByInvestigation"]>>;
    const plans = {
      loadPlanningContext: vi.fn(),
      findByInvestigation: vi.fn(async () => existing),
      createForInvestigation: vi.fn(),
    };
    const client = { createChatCompletion: vi.fn() };
    const result = await new InvestigationPlanningService(plans as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 10000, maxResponseBytes: 10000,
    }).generatePlan(investigationId);
    expect(result).toBe(existing);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it("validates provider JSON and persists a schema-valid artifact", async () => {
    const plans = {
      loadPlanningContext: vi.fn(async () => ({
        investigationId, status: "planning",
        claim: { id: claimId, statement: "Claim.", preservedQualifiers: [] },
        snapshot,
      })),
      findByInvestigation: vi.fn(async () => null),
      createForInvestigation: vi.fn(async (_id, artifact) => ({ id: "plan-1", artifact })),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(validResponse) } }],
        usage: { prompt_tokens: 12, completion_tokens: 34 },
      })),
    };
    const result = await new InvestigationPlanningService(plans as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 10000, maxResponseBytes: 10000,
    }).generatePlan(investigationId, { attemptId: "42" });
    expect(plans.createForInvestigation).toHaveBeenCalledWith(investigationId, expect.any(Object), expect.objectContaining({
      modelId: "qwen-plus", promptVersion: "planning-v1", attemptId: "42",
    }));
  });
});
