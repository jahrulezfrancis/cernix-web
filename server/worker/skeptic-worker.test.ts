import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "@/server/qwen/errors";
import { SkepticWorker } from "./skeptic-worker";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";
import type { SkepticWorkerQueue } from "./skeptic-worker";

const claim = { jobId: "11111111-1111-4111-8111-111111111111", investigationId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1, attemptId: "1", maxAttempts: 4, leaseToken: "33333333-3333-4333-8333-333333333333", leaseExpiresAt: new Date() };
const config = { owner: "worker-test", leaseSeconds: 180, heartbeatSeconds: 45, pollMs: 1_000, baseSeconds: 5, maximumSeconds: 300 };
const abortOnly: AbortableSleep = (_milliseconds, signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

function queue(overrides: Partial<SkepticWorkerQueue> = {}): SkepticWorkerQueue {
  return { claimNext: vi.fn(async () => ({ kind: "claimed", claim } as const)), heartbeat: vi.fn(async () => ({ kind: "updated", status: "leased" } as const)),
    completeSuccess: vi.fn(async () => ({ kind: "updated", status: "succeeded" } as const)),
    scheduleRetry: vi.fn(async () => ({ kind: "updated", status: "retry_wait" } as const)),
    completeFailure: vi.fn(async () => ({ kind: "updated", status: "failed" } as const)), ...overrides } as SkepticWorkerQueue;
}

describe("skeptic worker core", () => {
  it("returns idle without starting skeptic work", async () => {
    const q = queue({ claimNext: vi.fn(async () => ({ kind: "idle" } as const)) });
    const skeptic = { analyze: vi.fn() };
    await expect(new SkepticWorker(q, skeptic as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toEqual({ status: "idle" });
    expect(skeptic.analyze).not.toHaveBeenCalled();
  });

  it("analyzes and completes when skeptic work succeeds", async () => {
    const q = queue();
    const skeptic = { analyze: vi.fn(async () => ({ id: "analysis" })) };
    const result = await new SkepticWorker(q, skeptic as never, config, undefined, abortOnly).runOnce(new AbortController().signal);
    expect(result.status).toBe("succeeded");
    expect(skeptic.analyze).toHaveBeenCalledWith(claim.investigationId, { signal: expect.any(AbortSignal), attemptId: claim.attemptId });
    expect(q.completeSuccess).toHaveBeenCalledWith(claim.jobId, claim.leaseToken);
  });

  it("fails terminally on schema-invalid skeptic output", async () => {
    const q = queue();
    const skeptic = { analyze: vi.fn(async () => { throw new PlanningError("skeptic_schema_invalid"); }) };
    await expect(new SkepticWorker(q, skeptic as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "failed", failureCode: "skeptic_schema_invalid" });
    expect(q.completeFailure).toHaveBeenCalledWith(claim.jobId, claim.leaseToken, "skeptic_schema_invalid");
  });

  it("schedules retry for transient failures", async () => {
    const q = queue();
    const skeptic = { analyze: vi.fn(async () => { throw new ApplicationError("dependency_unavailable", {}); }) };
    await expect(new SkepticWorker(q, skeptic as never, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "retry_wait", failureCode: "dependency_unavailable" });
    expect(q.scheduleRetry).toHaveBeenCalledWith(claim.jobId, claim.leaseToken, "dependency_unavailable", 5);
  });
});
