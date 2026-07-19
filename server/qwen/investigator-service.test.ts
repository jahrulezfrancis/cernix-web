import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/investigator-readme.json";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "./errors";
import { RepositoryInvestigatorService } from "./investigator-service";

const runId = "11111111-1111-4111-8111-111111111111";
const claimId = "33333333-3333-4333-8333-333333333333";
const run = {
  id: runId, taskId: "task", investigationId: "22222222-2222-4222-8222-222222222222", claimId,
  taskKey: "task_readme", specialistCapability: "repository_investigator", status: "queued" as const,
  queryTerms: ["README"], expectedEvidenceTypes: ["repository_structure"], dependsOnTaskKeys: [], obligationKeys: ["obl_readme"],
};
const snapshot = {
  manifestHashSha256: "a".repeat(64), commitSha: "b".repeat(40), entries: [{
    path: "README.md", decision: "admitted", file: { normalizedText: "# Widget\n", normalizedSha256: "a".repeat(64) },
  }],
};

describe("repository investigator service", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("short-circuits when a persisted task result already exists", async () => {
    const evidence = {
      findTaskResultByRun: vi.fn(async () => fixture),
      loadInvestigatorContext: vi.fn(),
      persistTaskResult: vi.fn(),
      loadTaskRun: vi.fn(async () => run),
    };
    const client = { createChatCompletion: vi.fn() };
    const result = await new RepositoryInvestigatorService(evidence as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).investigateTask(runId);
    expect(result).toBe(run);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it("validates provider JSON and persists a schema-valid artifact", async () => {
    const evidence = {
      findTaskResultByRun: vi.fn(async () => null),
      loadInvestigatorContext: vi.fn(async () => ({
        run, claimStatement: "README exists.", obligationDescriptions: ["README exists."], snapshot,
      })),
      persistTaskResult: vi.fn(async () => fixture),
      loadTaskRun: vi.fn(async () => run),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(fixture) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      })),
    };
    await new RepositoryInvestigatorService(evidence as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).investigateTask(runId, { attemptId: "7" });
    expect(evidence.persistTaskResult).toHaveBeenCalledWith(runId, expect.any(Object), expect.objectContaining({
      modelId: "qwen-plus", attemptId: "7",
    }));
  });

  it("rejects oversized retrieval bundles before calling the provider", async () => {
    vi.stubEnv("CERNIX_EVIDENCE_MAX_CONTEXT_BYTES", "4096");
    const evidence = {
      findTaskResultByRun: vi.fn(async () => null),
      loadInvestigatorContext: vi.fn(async () => ({
        run, claimStatement: "README exists.", obligationDescriptions: ["README exists."],
        snapshot: { ...snapshot, entries: [{
          path: "README.md", decision: "admitted",
          file: { normalizedText: "README ".repeat(2_000), normalizedSha256: "a".repeat(64) },
        }] },
      })),
      persistTaskResult: vi.fn(),
      loadTaskRun: vi.fn(),
    };
    const client = { createChatCompletion: vi.fn() };
    await expect(new RepositoryInvestigatorService(evidence as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).investigateTask(runId)).rejects.toBeInstanceOf(PlanningError);
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it("maps Zod schema failures to evidence_schema_invalid", async () => {
    const evidence = {
      findTaskResultByRun: vi.fn(async () => null),
      loadInvestigatorContext: vi.fn(async () => ({
        run, claimStatement: "README exists.", obligationDescriptions: ["README exists."], snapshot,
      })),
      persistTaskResult: vi.fn(),
      loadTaskRun: vi.fn(),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({ notATaskResult: true }) } }],
      })),
    };
    await expect(new RepositoryInvestigatorService(evidence as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).investigateTask(runId)).rejects.toMatchObject({ failureCode: "evidence_schema_invalid" });
    expect(evidence.persistTaskResult).not.toHaveBeenCalled();
  });

  it("maps provenance persistence failures to evidence_schema_invalid", async () => {
    const evidence = {
      findTaskResultByRun: vi.fn(async () => null),
      loadInvestigatorContext: vi.fn(async () => ({
        run, claimStatement: "README exists.", obligationDescriptions: ["README exists."], snapshot,
      })),
      persistTaskResult: vi.fn(async () => { throw new ApplicationError("malformed_input", {}); }),
      loadTaskRun: vi.fn(),
    };
    const client = {
      createChatCompletion: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify(fixture) } }],
      })),
    };
    await expect(new RepositoryInvestigatorService(evidence as never, client as never, {
      apiKey: "k", apiOrigin: "https://dashscope.aliyuncs.com", modelId: "qwen-plus", promptVersion: "planning-v1",
      requestTimeoutMs: 1000, planningDeadlineMs: 2000, maxOutputTokens: 1000, maxContextBytes: 100000, maxResponseBytes: 100000,
    }).investigateTask(runId)).rejects.toMatchObject({ failureCode: "evidence_schema_invalid" });
  });
});
