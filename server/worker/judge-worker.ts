import type { PersistedInvestigationReport } from "@/server/persistence/judgment-repository";
import type { ClaimResult, MutationResult, JudgeJobClaim } from "./judge-job-repository";
import { classifyJudgeJobFailure } from "./judge-retry-policy";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";
import type { RetryPolicyConfig } from "./evidence-retry-policy";

export type JudgeWorkerLogFields = Readonly<{
  jobId?: string; investigationId?: string; attemptNumber?: number;
  status: "idle" | "succeeded" | "retry_wait" | "failed" | "cancelled" | "lease_lost" | "stopped";
  failureCode?: string;
}>;
export type JudgeWorkerLogger = Readonly<{ info(event: "judge_job", fields: JudgeWorkerLogFields): void }>;
export type JudgeWorkerRunResult = JudgeWorkerLogFields;
export type JudgeWorkerQueue = Readonly<{
  claimNext(options: { workerOwner: string; leaseSeconds: number }): Promise<ClaimResult>;
  heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<MutationResult>;
  completeSuccess(jobId: string, leaseToken: string): Promise<MutationResult>;
  scheduleRetry(jobId: string, leaseToken: string, failureCode: string, delaySeconds: number): Promise<MutationResult>;
  completeFailure(jobId: string, leaseToken: string, failureCode: string): Promise<MutationResult>;
}>;
export type JudgeInvestigationOptions = Readonly<{ signal?: AbortSignal; attemptId?: string }>;
export type JudgeExecutor = Readonly<{
  judge(investigationId: string, options?: JudgeInvestigationOptions): Promise<PersistedInvestigationReport>;
}>;

function leaseLost(result: MutationResult): boolean { return result.kind === "lease_lost" || result.kind === "not_found"; }

export class JudgeWorker {
  constructor(private readonly queue: JudgeWorkerQueue, private readonly judge: JudgeExecutor,
    private readonly config: Readonly<{ owner: string; leaseSeconds: number; heartbeatSeconds: number; pollMs: number } & RetryPolicyConfig>,
    private readonly logger: JudgeWorkerLogger = { info() {} }, private readonly sleep: AbortableSleep = abortableSleep) {}

  async runOnce(signal: AbortSignal): Promise<JudgeWorkerRunResult> {
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

  private async execute(claim: JudgeJobClaim, shutdown: AbortSignal): Promise<JudgeWorkerRunResult> {
    const work = new AbortController(), heartbeatStop = new AbortController();
    let lost = false;
    const stopWork = () => work.abort(shutdown.reason ?? new Error("Worker shutdown."));
    shutdown.addEventListener("abort", stopWork, { once: true });
    if (shutdown.aborted) stopWork();
    const heartbeat = this.heartbeatLoop(claim, work, heartbeatStop.signal, () => { lost = true; });
    let jobError: unknown, completed = false;
    try {
      await this.judge.judge(claim.investigationId, { signal: work.signal, attemptId: claim.attemptId });
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

    const decision = classifyJudgeJobFailure(jobError, claim.attemptNumber, claim.maxAttempts,
      { baseSeconds: this.config.baseSeconds, maximumSeconds: this.config.maximumSeconds }, shutdown.aborted);
    const mutation = decision.disposition === "retry"
      ? await this.queue.scheduleRetry(claim.jobId, claim.leaseToken, decision.failureCode, decision.delaySeconds!)
      : await this.queue.completeFailure(claim.jobId, claim.leaseToken, decision.failureCode);
    if (leaseLost(mutation) || mutation.kind !== "updated") return this.report(this.fields(claim, "lease_lost"));
    const status = decision.disposition === "retry" ? "retry_wait" : "failed";
    return this.report({ ...this.fields(claim, status), failureCode: decision.failureCode });
  }

  private async heartbeatLoop(claim: JudgeJobClaim, work: AbortController, stop: AbortSignal, lost: () => void): Promise<void> {
    while (!stop.aborted) {
      try { await this.sleep(this.config.heartbeatSeconds * 1_000, stop); } catch { return; }
      try {
        const result = await this.queue.heartbeat(claim.jobId, claim.leaseToken, this.config.leaseSeconds);
        if (result.kind !== "updated") { lost(); work.abort(new Error("Judge job lease lost.")); return; }
      } catch { lost(); work.abort(new Error("Judge job heartbeat failed.")); return; }
    }
  }

  private fields(claim: JudgeJobClaim, status: JudgeWorkerLogFields["status"]): JudgeWorkerLogFields {
    return { jobId: claim.jobId, investigationId: claim.investigationId, attemptNumber: claim.attemptNumber, status };
  }
  private report(result: JudgeWorkerRunResult): JudgeWorkerRunResult { this.logger.info("judge_job", result); return result; }
}
