import type { PersistedSkepticAnalysis } from "@/server/persistence/skeptic-repository";
import type { ClaimResult, MutationResult, SkepticJobClaim } from "./skeptic-job-repository";
import { classifySkepticJobFailure } from "./skeptic-retry-policy";
import type { RetryPolicyConfig } from "./evidence-retry-policy";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";

export type SkepticWorkerLogFields = Readonly<{
  jobId?: string; investigationId?: string; attemptNumber?: number;
  status: "idle" | "succeeded" | "retry_wait" | "failed" | "cancelled" | "lease_lost" | "stopped";
  failureCode?: string;
}>;
export type SkepticWorkerLogger = Readonly<{ info(event: "skeptic_job", fields: SkepticWorkerLogFields): void }>;
export type SkepticWorkerRunResult = SkepticWorkerLogFields;
export type SkepticWorkerQueue = Readonly<{
  claimNext(options: { workerOwner: string; leaseSeconds: number }): Promise<ClaimResult>;
  heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<MutationResult>;
  completeSuccess(jobId: string, leaseToken: string): Promise<MutationResult>;
  scheduleRetry(jobId: string, leaseToken: string, failureCode: string, delaySeconds: number): Promise<MutationResult>;
  completeFailure(jobId: string, leaseToken: string, failureCode: string): Promise<MutationResult>;
}>;
export type AnalyzeInvestigationOptions = Readonly<{ signal?: AbortSignal; attemptId?: string }>;
export type SkepticExecutor = Readonly<{
  analyze(investigationId: string, options?: AnalyzeInvestigationOptions): Promise<PersistedSkepticAnalysis>;
}>;

function leaseLost(result: MutationResult): boolean { return result.kind === "lease_lost" || result.kind === "not_found"; }

export class SkepticWorker {
  constructor(private readonly queue: SkepticWorkerQueue, private readonly skeptic: SkepticExecutor,
    private readonly config: Readonly<{ owner: string; leaseSeconds: number; heartbeatSeconds: number; pollMs: number } & RetryPolicyConfig>,
    private readonly logger: SkepticWorkerLogger = { info() {} }, private readonly sleep: AbortableSleep = abortableSleep) {}

  async runOnce(signal: AbortSignal): Promise<SkepticWorkerRunResult> {
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

  private async execute(claim: SkepticJobClaim, shutdown: AbortSignal): Promise<SkepticWorkerRunResult> {
    const work = new AbortController(), heartbeatStop = new AbortController();
    let lost = false;
    const stopWork = () => work.abort(shutdown.reason ?? new Error("Worker shutdown."));
    shutdown.addEventListener("abort", stopWork, { once: true });
    if (shutdown.aborted) stopWork();
    const heartbeat = this.heartbeatLoop(claim, work, heartbeatStop.signal, () => { lost = true; });
    let jobError: unknown, completed = false;
    try {
      await this.skeptic.analyze(claim.investigationId, { signal: work.signal, attemptId: claim.attemptId });
      completed = true;
    } catch (error) { jobError = error; }
    heartbeatStop.abort();
    await heartbeat;
    shutdown.removeEventListener("abort", stopWork);
    if (lost) return this.report(this.fields(claim, "lease_lost"));

    if (completed && !shutdown.aborted) {
      const finalized = await this.queue.completeSuccess(claim.jobId, claim.leaseToken);
      return this.report(this.fields(claim, finalized.kind === "updated" ||
        (finalized.kind === "already_terminal" && finalized.status === "succeeded") ? "succeeded" : "lease_lost"));
    }

    const decision = classifySkepticJobFailure(jobError, claim.attemptNumber, claim.maxAttempts,
      { baseSeconds: this.config.baseSeconds, maximumSeconds: this.config.maximumSeconds }, shutdown.aborted);
    const mutation = decision.disposition === "retry"
      ? await this.queue.scheduleRetry(claim.jobId, claim.leaseToken, decision.failureCode, decision.delaySeconds!)
      : await this.queue.completeFailure(claim.jobId, claim.leaseToken, decision.failureCode);
    if (leaseLost(mutation) || mutation.kind !== "updated") return this.report(this.fields(claim, "lease_lost"));
    const status = decision.disposition === "retry" ? "retry_wait" : "failed";
    return this.report({ ...this.fields(claim, status), failureCode: decision.failureCode });
  }

  private async heartbeatLoop(claim: SkepticJobClaim, work: AbortController, stop: AbortSignal, lost: () => void): Promise<void> {
    while (!stop.aborted) {
      try { await this.sleep(this.config.heartbeatSeconds * 1_000, stop); } catch { return; }
      try {
        const result = await this.queue.heartbeat(claim.jobId, claim.leaseToken, this.config.leaseSeconds);
        if (result.kind !== "updated") { lost(); work.abort(new Error("Skeptic job lease lost.")); return; }
      } catch { lost(); work.abort(new Error("Skeptic job heartbeat failed.")); return; }
    }
  }

  private fields(claim: SkepticJobClaim, status: SkepticWorkerLogFields["status"]): SkepticWorkerLogFields {
    return { jobId: claim.jobId, investigationId: claim.investigationId, attemptNumber: claim.attemptNumber, status };
  }
  private report(result: SkepticWorkerRunResult): SkepticWorkerRunResult { this.logger.info("skeptic_job", result); return result; }
}
