import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "@/server/qwen/errors";
import { EvidenceWorker } from "./evidence-worker";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";
import type { EvidenceWorkerQueue } from "./evidence-worker";

const claim = { jobId: "11111111-1111-4111-8111-111111111111", investigationId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1, attemptId: "1", maxAttempts: 4, leaseToken: "33333333-3333-4333-8333-333333333333", leaseExpiresAt: new Date() };
const config = { owner: "worker-test", leaseSeconds: 180, heartbeatSeconds: 45, pollMs: 1_000, baseSeconds: 5, maximumSeconds: 300 };
const abortOnly: AbortableSleep = (_milliseconds, signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
const run = { id: "run-1", taskKey: "task_readme", status: "queued" as const };

function queue(overrides: Partial<EvidenceWorkerQueue> = {}): EvidenceWorkerQueue {
  return { claimNext: vi.fn(async () => ({ kind: "claimed", claim } as const)), heartbeat: vi.fn(async () => ({ kind: "updated", status: "leased" } as const)),
    completeSuccess: vi.fn(async () => ({ kind: "updated", status: "succeeded" } as const)),
    scheduleRetry: vi.fn(async () => ({ kind: "updated", status: "retry_wait" } as const)),
    completeFailure: vi.fn(async () => ({ kind: "updated", status: "failed" } as const)), ...overrides } as EvidenceWorkerQueue;
}

describe("evidence worker core", () => {
  it("returns idle without starting evidence work", async () => {
    const q = queue({ claimNext: vi.fn(async () => ({ kind: "idle" } as const)) });
    const investigator = { investigateTask: vi.fn() };
    const evidence = { getNextRunnableTaskRun: vi.fn(), isCollectionComplete: vi.fn() };
    await expect(new EvidenceWorker(q, investigator as never, evidence as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toEqual({ status: "idle" });
    expect(investigator.investigateTask).not.toHaveBeenCalled();
  });

  it("processes runnable tasks and completes when collection is finished", async () => {
    const q = queue();
    const investigator = { investigateTask: vi.fn(async () => run) };
    const evidence = {
      getNextRunnableTaskRun: vi.fn()
        .mockResolvedValueOnce(run)
        .mockResolvedValueOnce(null),
      isCollectionComplete: vi.fn(async () => true),
    };
    const result = await new EvidenceWorker(q, investigator as never, evidence as never, config, undefined, abortOnly).runOnce(new AbortController().signal);
    expect(result.status).toBe("succeeded");
    expect(investigator.investigateTask).toHaveBeenCalledWith(run.id, { signal: expect.any(AbortSignal), attemptId: claim.attemptId });
    expect(q.completeSuccess).toHaveBeenCalledWith(claim.jobId, claim.leaseToken);
  });

  it("marks terminal schema failures on a task and continues", async () => {
    const q = queue();
    const investigator = {
      investigateTask: vi.fn()
        .mockRejectedValueOnce(new PlanningError("evidence_schema_invalid"))
        .mockResolvedValueOnce(run),
    };
    const evidence = {
      getNextRunnableTaskRun: vi.fn()
        .mockResolvedValueOnce({ ...run, id: "run-bad" })
        .mockResolvedValueOnce(run)
        .mockResolvedValueOnce(null),
      markTaskRunFailed: vi.fn(async () => undefined),
      isCollectionComplete: vi.fn(async () => true),
    };
    await expect(new EvidenceWorker(q, investigator as never, evidence as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "succeeded" });
    expect(evidence.markTaskRunFailed).toHaveBeenCalledWith("run-bad", "evidence_schema_invalid");
  });

  it("schedules retry for transient failures", async () => {
    const q = queue();
    const investigator = { investigateTask: vi.fn(async () => { throw new ApplicationError("dependency_unavailable", {}); }) };
    const evidence = { getNextRunnableTaskRun: vi.fn(async () => run), isCollectionComplete: vi.fn() };
    await expect(new EvidenceWorker(q, investigator as never, evidence as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "retry_wait", failureCode: "dependency_unavailable" });
    expect(q.scheduleRetry).toHaveBeenCalledWith(claim.jobId, claim.leaseToken, "dependency_unavailable", 5);
  });
});
