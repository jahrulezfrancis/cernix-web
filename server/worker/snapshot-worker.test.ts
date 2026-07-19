import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "@/server/errors";
import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { SnapshotWorker, type AbortableSleep, type WorkerQueue } from "./snapshot-worker";

const claim = { jobId: "11111111-1111-4111-8111-111111111111", investigationId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1, maxAttempts: 4, leaseToken: "33333333-3333-4333-8333-333333333333", leaseExpiresAt: new Date() };
const config = { owner: "worker-test", leaseSeconds: 120, heartbeatSeconds: 30, pollMs: 1_000, baseSeconds: 5, maximumSeconds: 300 };
const abortOnly: AbortableSleep = (_milliseconds, signal) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
function queue(overrides: Partial<WorkerQueue> = {}): WorkerQueue {
  return { claimNext: vi.fn(async () => ({ kind: "claimed", claim } as const)), heartbeat: vi.fn(async () => ({ kind: "updated", status: "leased" } as const)),
    completeSuccess: vi.fn(async () => ({ kind: "updated", status: "succeeded" } as const)),
    scheduleRetry: vi.fn(async () => ({ kind: "updated", status: "retry_wait" } as const)),
    completeFailure: vi.fn(async () => ({ kind: "updated", status: "failed" } as const)), ...overrides } as WorkerQueue;
}
const snapshot = { id: "snapshot" } as PersistedRepositorySnapshot;

describe("snapshot worker core", () => {
  it("returns idle without starting snapshot work", async () => {
    const q = queue({ claimNext: vi.fn(async () => ({ kind: "idle" } as const)) });
    const service = { snapshotInvestigation: vi.fn() };
    await expect(new SnapshotWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toEqual({ status: "idle" });
    expect(service.snapshotInvestigation).not.toHaveBeenCalled();
  });

  it("claims, snapshots, and completes with the fenced token", async () => {
    const q = queue(), service = { snapshotInvestigation: vi.fn(async () => snapshot) };
    const result = await new SnapshotWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal);
    expect(result.status).toBe("succeeded");
    expect(service.snapshotInvestigation).toHaveBeenCalledWith(claim.investigationId, expect.any(AbortSignal));
    expect(q.completeSuccess).toHaveBeenCalledWith(claim.jobId, claim.leaseToken);
  });

  it("schedules one retry for a classified transient failure", async () => {
    const q = queue(), service = { snapshotInvestigation: vi.fn(async () => { throw new ApplicationError("dependency_unavailable", {}); }) };
    await expect(new SnapshotWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "retry_wait", failureCode: "dependency_unavailable" });
    expect(q.scheduleRetry).toHaveBeenCalledWith(claim.jobId, claim.leaseToken, "dependency_unavailable", 5);
  });

  it("terminally fails deterministic and exhausted failures", async () => {
    for (const [error, claimed, code] of [
      [new ApplicationError("invalid_repository_url", {}), claim, "invalid_repository_url"],
      [new ApplicationError("internal_error", {}), { ...claim, attemptNumber: 4 }, "attempts_exhausted"],
    ] as const) {
      const q = queue({ claimNext: vi.fn(async () => ({ kind: "claimed", claim: claimed } as const)) });
      const service = { snapshotInvestigation: vi.fn(async () => { throw error; }) };
      await expect(new SnapshotWorker(q, service, config, undefined, abortOnly).runOnce(new AbortController().signal))
        .resolves.toMatchObject({ status: "failed", failureCode: code });
      expect(q.completeFailure).toHaveBeenCalledWith(claim.jobId, claim.leaseToken, code);
    }
  });

  it("aborts snapshot work and forbids finalization after heartbeat lease loss", async () => {
    let sleeps = 0;
    const immediateThenAbort: AbortableSleep = (_milliseconds, signal) => sleeps++ === 0 ? Promise.resolve() : abortOnly(0, signal);
    const q = queue({ heartbeat: vi.fn(async () => ({ kind: "lease_lost" } as const)) });
    const service = { snapshotInvestigation: vi.fn((_id, signal?: AbortSignal) => new Promise<PersistedRepositorySnapshot>((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
    })) };
    await expect(new SnapshotWorker(q, service, config, undefined, immediateThenAbort).runOnce(new AbortController().signal))
      .resolves.toMatchObject({ status: "lease_lost" });
    expect(q.completeSuccess).not.toHaveBeenCalled();
    expect(q.scheduleRetry).not.toHaveBeenCalled();
    expect(q.completeFailure).not.toHaveBeenCalled();
  });

  it("does not claim after shutdown and releases owned interrupted work to retry", async () => {
    const stopped = new AbortController(), q = queue(); stopped.abort();
    await expect(new SnapshotWorker(q, { snapshotInvestigation: vi.fn() }, config, undefined, abortOnly).runOnce(stopped.signal))
      .resolves.toEqual({ status: "stopped" });
    expect(q.claimNext).not.toHaveBeenCalled();

    const active = new AbortController();
    const service = { snapshotInvestigation: vi.fn((_id, signal?: AbortSignal) => new Promise<PersistedRepositorySnapshot>((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }); active.abort();
    })) };
    await expect(new SnapshotWorker(q, service, config, undefined, abortOnly).runOnce(active.signal))
      .resolves.toMatchObject({ status: "retry_wait", failureCode: "worker_shutdown" });
  });

  it("stops an idle loop without another claim and logs only allowlisted fields", async () => {
    const controller = new AbortController(), info = vi.fn();
    const q = queue({ claimNext: vi.fn(async () => ({ kind: "idle" } as const)) });
    const stopSleep: AbortableSleep = async () => { controller.abort(); };
    await new SnapshotWorker(q, { snapshotInvestigation: vi.fn() }, config, { info }, stopSleep).runLoop(controller.signal);
    expect(q.claimNext).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("snapshot_job", { status: "idle" });
    expect(JSON.stringify(info.mock.calls)).not.toContain("token");
  });
});
