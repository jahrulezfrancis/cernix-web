import { describe, expect, it, vi } from "vitest";
import { PlanningError } from "@/server/qwen/errors";
import { JudgeWorker } from "./judge-worker";
import { type AbortableSleep } from "./snapshot-worker";
import type { JudgeWorkerQueue } from "./judge-worker";

const claim = { jobId: "11111111-1111-4111-8111-111111111111", investigationId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1, attemptId: "1", maxAttempts: 4, leaseToken: "33333333-3333-4333-8333-333333333333", leaseExpiresAt: new Date() };
const config = { owner: "worker-test", leaseSeconds: 180, heartbeatSeconds: 45, pollMs: 1_000, baseSeconds: 5, maximumSeconds: 300 };
const abortOnly: AbortableSleep = (_milliseconds, signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

function queue(overrides: Partial<JudgeWorkerQueue> = {}): JudgeWorkerQueue {
  return { claimNext: vi.fn(async () => ({ kind: "claimed", claim } as const)), heartbeat: vi.fn(async () => ({ kind: "updated", status: "leased" } as const)),
    completeSuccess: vi.fn(async () => ({ kind: "updated", status: "succeeded" } as const)),
    scheduleRetry: vi.fn(async () => ({ kind: "updated", status: "retry_wait" } as const)),
    completeFailure: vi.fn(async () => ({ kind: "updated", status: "failed" } as const)), ...overrides } as JudgeWorkerQueue;
}

describe("judge worker core", () => {
  it("judges and completes when work succeeds", async () => {
    const q = queue();
    const judge = { judge: vi.fn(async () => ({ id: "report" })) };
    const result = await new JudgeWorker(q, judge as never, config, undefined, abortOnly).runOnce(new AbortController().signal);
    expect(result.status).toBe("succeeded");
    expect(q.completeSuccess).toHaveBeenCalledWith(claim.jobId, claim.leaseToken);
  });

  it("fails terminally on schema-invalid judge output", async () => {
    const q = queue();
    const judge = { judge: vi.fn(async () => { throw new PlanningError("judge_schema_invalid"); }) };
    await expect(new JudgeWorker(q, judge as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "failed", failureCode: "judge_schema_invalid" });
  });
});
