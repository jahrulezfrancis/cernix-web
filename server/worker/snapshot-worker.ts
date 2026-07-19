import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import type { ClaimResult, MutationResult, SnapshotJobClaim } from "./snapshot-job-repository";
import { classifySnapshotJobFailure, type RetryPolicyConfig } from "./retry-policy";

export type WorkerLogFields = Readonly<{
  jobId?: string; investigationId?: string; attemptNumber?: number;
  status: "idle" | "succeeded" | "retry_wait" | "failed" | "cancelled" | "lease_lost" | "stopped";
  failureCode?: string;
}>;
export type WorkerLogger = Readonly<{ info(event: "snapshot_job", fields: WorkerLogFields): void }>;
export type WorkerRunResult = WorkerLogFields;
export type WorkerQueue = Readonly<{
  claimNext(options: { workerOwner: string; leaseSeconds: number }): Promise<ClaimResult>;
  heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<MutationResult>;
  completeSuccess(jobId: string, leaseToken: string): Promise<MutationResult>;
  scheduleRetry(jobId: string, leaseToken: string, failureCode: string, delaySeconds: number): Promise<MutationResult>;
  completeFailure(jobId: string, leaseToken: string, failureCode: string): Promise<MutationResult>;
}>;
export type SnapshotExecutor = Readonly<{
  snapshotInvestigation(investigationId: unknown, signal?: AbortSignal): Promise<PersistedRepositorySnapshot>;
}>;
export type AbortableSleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export const abortableSleep: AbortableSleep = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(done, milliseconds);
  function done() { signal.removeEventListener("abort", aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(signal.reason); }
  signal.addEventListener("abort", aborted, { once: true });
});

function leaseLost(result: MutationResult): boolean { return result.kind === "lease_lost" || result.kind === "not_found"; }

export class SnapshotWorker {
  constructor(private readonly queue: WorkerQueue, private readonly snapshots: SnapshotExecutor,
    private readonly config: Readonly<{ owner: string; leaseSeconds: number; heartbeatSeconds: number; pollMs: number } & RetryPolicyConfig>,
    private readonly logger: WorkerLogger = { info() {} }, private readonly sleep: AbortableSleep = abortableSleep) {}

  async runOnce(signal: AbortSignal): Promise<WorkerRunResult> {
    if (signal.aborted) return this.report({ status: "stopped" });
    const result = await this.queue.claimNext({ workerOwner: this.config.owner, leaseSeconds: this.config.leaseSeconds });
    if (result.kind === "idle") return this.report({ status: "idle" });
    if (result.kind === "reconciled") return this.report({ jobId: result.jobId, status: result.status });
    return this.execute(result.claim, signal);
  }

  async runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await this.runOnce(signal);
      if (signal.aborted || result.status === "stopped") break;
      if (result.status === "idle") {
        try { await this.sleep(this.config.pollMs, signal); } catch { break; }
      }
    }
  }

  private async execute(claim: SnapshotJobClaim, shutdown: AbortSignal): Promise<WorkerRunResult> {
    const work = new AbortController(), heartbeatStop = new AbortController();
    let lost = false;
    const stopWork = () => work.abort(shutdown.reason ?? new Error("Worker shutdown."));
    shutdown.addEventListener("abort", stopWork, { once: true });
    if (shutdown.aborted) stopWork();
    const heartbeat = this.heartbeatLoop(claim, work, heartbeatStop.signal, () => { lost = true; });
    let snapshotError: unknown, completed = false;
    try {
      await this.snapshots.snapshotInvestigation(claim.investigationId, work.signal);
      completed = true;
    } catch (error) { snapshotError = error; }
    heartbeatStop.abort();
    await heartbeat;
    shutdown.removeEventListener("abort", stopWork);
    if (lost) return this.report(this.fields(claim, "lease_lost"));

    if (completed && !shutdown.aborted) {
      const finalized = await this.queue.completeSuccess(claim.jobId, claim.leaseToken);
      return this.report(this.fields(claim, finalized.kind === "updated" ||
        (finalized.kind === "already_terminal" && finalized.status === "succeeded") ? "succeeded" : "lease_lost"));
    }

    const decision = classifySnapshotJobFailure(snapshotError, claim.attemptNumber, claim.maxAttempts,
      { baseSeconds: this.config.baseSeconds, maximumSeconds: this.config.maximumSeconds }, shutdown.aborted);
    const mutation = decision.disposition === "retry"
      ? await this.queue.scheduleRetry(claim.jobId, claim.leaseToken, decision.failureCode, decision.delaySeconds!)
      : await this.queue.completeFailure(claim.jobId, claim.leaseToken, decision.failureCode);
    if (leaseLost(mutation) || mutation.kind !== "updated") return this.report(this.fields(claim, "lease_lost"));
    const status = decision.disposition === "retry" ? "retry_wait" : "failed";
    return this.report({ ...this.fields(claim, status), failureCode: decision.failureCode });
  }

  private async heartbeatLoop(claim: SnapshotJobClaim, work: AbortController, stop: AbortSignal, lost: () => void): Promise<void> {
    while (!stop.aborted) {
      try { await this.sleep(this.config.heartbeatSeconds * 1_000, stop); } catch { return; }
      try {
        const result = await this.queue.heartbeat(claim.jobId, claim.leaseToken, this.config.leaseSeconds);
        if (result.kind !== "updated") { lost(); work.abort(new Error("Snapshot job lease lost.")); return; }
      } catch {
        lost(); work.abort(new Error("Snapshot job heartbeat failed.")); return;
      }
    }
  }

  private fields(claim: SnapshotJobClaim, status: WorkerLogFields["status"]): WorkerLogFields {
    return { jobId: claim.jobId, investigationId: claim.investigationId, attemptNumber: claim.attemptNumber, status };
  }
  private report(result: WorkerRunResult): WorkerRunResult { this.logger.info("snapshot_job", result); return result; }
}
