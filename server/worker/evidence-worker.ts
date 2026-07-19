import type { EvidenceRepository } from "@/server/persistence/evidence-repository";
import type { RepositoryInvestigatorService, InvestigateTaskOptions } from "@/server/qwen/investigator-service";
import { PlanningError } from "@/server/qwen/errors";
import type { ClaimResult, MutationResult, EvidenceJobClaim } from "./evidence-job-repository";
import { classifyEvidenceJobFailure, type RetryPolicyConfig } from "./evidence-retry-policy";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";

export type EvidenceWorkerLogFields = Readonly<{
  jobId?: string; investigationId?: string; attemptNumber?: number;
  status: "idle" | "succeeded" | "retry_wait" | "failed" | "cancelled" | "lease_lost" | "stopped";
  failureCode?: string;
}>;
export type EvidenceWorkerLogger = Readonly<{ info(event: "evidence_job", fields: EvidenceWorkerLogFields): void }>;
export type EvidenceWorkerRunResult = EvidenceWorkerLogFields;
export type EvidenceWorkerQueue = Readonly<{
  claimNext(options: { workerOwner: string; leaseSeconds: number }): Promise<ClaimResult>;
  heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<MutationResult>;
  completeSuccess(jobId: string, leaseToken: string): Promise<MutationResult>;
  scheduleRetry(jobId: string, leaseToken: string, failureCode: string, delaySeconds: number): Promise<MutationResult>;
  completeFailure(jobId: string, leaseToken: string, failureCode: string): Promise<MutationResult>;
}>;

function leaseLost(result: MutationResult): boolean { return result.kind === "lease_lost" || result.kind === "not_found"; }

export class EvidenceWorker {
  constructor(private readonly queue: EvidenceWorkerQueue, private readonly investigator: RepositoryInvestigatorService,
    private readonly evidence: EvidenceRepository,
    private readonly config: Readonly<{ owner: string; leaseSeconds: number; heartbeatSeconds: number; pollMs: number } & RetryPolicyConfig>,
    private readonly logger: EvidenceWorkerLogger = { info() {} }, private readonly sleep: AbortableSleep = abortableSleep) {}

  async runOnce(signal: AbortSignal): Promise<EvidenceWorkerRunResult> {
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

  private async execute(claim: EvidenceJobClaim, shutdown: AbortSignal): Promise<EvidenceWorkerRunResult> {
    const work = new AbortController(), heartbeatStop = new AbortController();
    let lost = false;
    const stopWork = () => work.abort(shutdown.reason ?? new Error("Worker shutdown."));
    shutdown.addEventListener("abort", stopWork, { once: true });
    if (shutdown.aborted) stopWork();
    const heartbeat = this.heartbeatLoop(claim, work, heartbeatStop.signal, () => { lost = true; });
    let jobError: unknown;
    try {
      while (!work.signal.aborted && !lost) {
        const task = await this.evidence.getNextRunnableTaskRun(claim.investigationId);
        if (!task) break;
        try {
          const options: InvestigateTaskOptions = { signal: work.signal, attemptId: claim.attemptId };
          await this.investigator.investigateTask(task.id, options);
        } catch (error) {
          if (error instanceof PlanningError &&
              (error.failureCode === "evidence_schema_invalid" || error.failureCode === "evidence_context_invalid")) {
            await this.evidence.markTaskRunFailed(task.id, error.failureCode);
            continue;
          }
          throw error;
        }
      }
    } catch (error) { jobError = error; }
    heartbeatStop.abort();
    await heartbeat;
    shutdown.removeEventListener("abort", stopWork);
    if (lost) return this.report(this.fields(claim, "lease_lost"));
    if (jobError) {
      const decision = classifyEvidenceJobFailure(jobError, claim.attemptNumber, claim.maxAttempts,
        { baseSeconds: this.config.baseSeconds, maximumSeconds: this.config.maximumSeconds }, shutdown.aborted);
      const mutation = decision.disposition === "retry"
        ? await this.queue.scheduleRetry(claim.jobId, claim.leaseToken, decision.failureCode, decision.delaySeconds!)
        : await this.queue.completeFailure(claim.jobId, claim.leaseToken, decision.failureCode);
      if (leaseLost(mutation) || mutation.kind !== "updated") return this.report(this.fields(claim, "lease_lost"));
      return this.report({ ...this.fields(claim, decision.disposition === "retry" ? "retry_wait" : "failed"), failureCode: decision.failureCode });
    }
    if (await this.evidence.isCollectionComplete(claim.investigationId)) {
      const finalized = await this.queue.completeSuccess(claim.jobId, claim.leaseToken);
      return this.report(this.fields(claim, finalized.kind === "updated" ||
        (finalized.kind === "already_terminal" && finalized.status === "succeeded") ? "succeeded" : "lease_lost"));
    }
    const retry = await this.queue.scheduleRetry(claim.jobId, claim.leaseToken, "internal_error", this.config.baseSeconds);
    if (retry.kind !== "updated") return this.report(this.fields(claim, "lease_lost"));
    return this.report({ ...this.fields(claim, "retry_wait"), failureCode: "internal_error" });
  }

  private async heartbeatLoop(claim: EvidenceJobClaim, work: AbortController, stop: AbortSignal, lost: () => void): Promise<void> {
    while (!stop.aborted) {
      try { await this.sleep(this.config.heartbeatSeconds * 1_000, stop); } catch { return; }
      try {
        const result = await this.queue.heartbeat(claim.jobId, claim.leaseToken, this.config.leaseSeconds);
        if (result.kind !== "updated") { lost(); work.abort(new Error("Evidence job lease lost.")); return; }
      } catch { lost(); work.abort(new Error("Evidence job heartbeat failed.")); return; }
    }
  }

  private fields(claim: EvidenceJobClaim, status: EvidenceWorkerLogFields["status"]): EvidenceWorkerLogFields {
    return { jobId: claim.jobId, investigationId: claim.investigationId, attemptNumber: claim.attemptNumber, status };
  }
  private report(result: EvidenceWorkerRunResult): EvidenceWorkerRunResult { this.logger.info("evidence_job", result); return result; }
}
