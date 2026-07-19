import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "@/server/errors";
import type { PersistedInvestigationPlan } from "@/server/persistence/investigation-plan-repository";
import { PlanningWorker } from "./planning-worker";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";
import type { PlanningWorkerQueue } from "./planning-worker";

const claim = { jobId: "11111111-1111-4111-8111-111111111111", investigationId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1, attemptId: "1", maxAttempts: 4, leaseToken: "33333333-3333-4333-8333-333333333333", leaseExpiresAt: new Date() };
const config = { owner: "worker-test", leaseSeconds: 120, heartbeatSeconds: 30, pollMs: 1_000, baseSeconds: 5, maximumSeconds: 300 };
const abortOnly: AbortableSleep = (_milliseconds, signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
function queue(overrides: Partial<PlanningWorkerQueue> = {}): PlanningWorkerQueue {
  return { claimNext: vi.fn(async () => ({ kind: "claimed", claim } as const)), heartbeat: vi.fn(async () => ({ kind: "updated", status: "leased" } as const)),
    completeSuccess: vi.fn(async () => ({ kind: "updated", status: "succeeded" } as const)),
    scheduleRetry: vi.fn(async () => ({ kind: "updated", status: "retry_wait" } as const)),
    completeFailure: vi.fn(async () => ({ kind: "updated", status: "failed" } as const)), ...overrides } as PlanningWorkerQueue;
}
const plan = { id: "plan" } as PersistedInvestigationPlan;

describe("planning worker core", () => {
  it("returns idle without starting planning work", async () => {
    const q = queue({ claimNext: vi.fn(async () => ({ kind: "idle" } as const)) });
    const service = { generatePlan: vi.fn() };
    await expect(new PlanningWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toEqual({ status: "idle" });
    expect(service.generatePlan).not.toHaveBeenCalled();
  });

  it("claims, plans, and completes with the fenced token", async () => {
    const q = queue(), service = { generatePlan: vi.fn(async () => plan) };
    const result = await new PlanningWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal);
    expect(result.status).toBe("succeeded");
    expect(service.generatePlan).toHaveBeenCalledWith(claim.investigationId, { signal: expect.any(AbortSignal), attemptId: claim.attemptId });
    expect(q.completeSuccess).toHaveBeenCalledWith(claim.jobId, claim.leaseToken);
  });

  it("schedules one retry for a classified transient failure", async () => {
    const q = queue(), service = { generatePlan: vi.fn(async () => { throw new ApplicationError("dependency_unavailable", {}); }) };
    await expect(new PlanningWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "retry_wait", failureCode: "dependency_unavailable" });
    expect(q.scheduleRetry).toHaveBeenCalledWith(claim.jobId, claim.leaseToken, "dependency_unavailable", 5);
  });

  it("aborts planning work and forbids finalization after heartbeat lease loss", async () => {
    let sleeps = 0;
    const immediateThenAbort: AbortableSleep = (_milliseconds, signal) => sleeps++ === 0 ? Promise.resolve() : abortOnly(0, signal);
    const q = queue({ heartbeat: vi.fn(async () => ({ kind: "lease_lost" } as const)) });
    const service = { generatePlan: vi.fn((_id, options?: { signal?: AbortSignal }) => new Promise<PersistedInvestigationPlan>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    })) };
    await expect(new PlanningWorker(q, service, config, undefined, immediateThenAbort).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "lease_lost" });
    expect(q.completeSuccess).not.toHaveBeenCalled();
  });

  it("does not claim after shutdown and releases owned interrupted work to retry", async () => {
    const stopped = new AbortController(), q = queue(); stopped.abort();
    await expect(new PlanningWorker(q, { generatePlan: vi.fn() }, config, undefined, abortOnly).runOnce(stopped.signal))
      .resolves.toEqual({ status: "stopped" });
    expect(q.claimNext).not.toHaveBeenCalled();
  });
});
