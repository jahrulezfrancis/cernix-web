import type { PersistedInvestigationPlan } from "@/server/persistence/investigation-plan-repository";
import type { ClaimResult, MutationResult, PlanningJobClaim } from "./planning-job-repository";
import { classifyPlanningJobFailure, type RetryPolicyConfig } from "./planning-retry-policy";
import { abortableSleep, type AbortableSleep } from "./snapshot-worker";

export type PlanningWorkerLogFields = Readonly<{
  jobId?: string; investigationId?: string; attemptNumber?: number;
  status: "idle" | "succeeded" | "retry_wait" | "failed" | "cancelled" | "lease_lost" | "stopped";
  failureCode?: string;
}>;
export type PlanningWorkerLogger = Readonly<{ info(event: "planning_job", fields: PlanningWorkerLogFields): void }>;
export type PlanningWorkerRunResult = PlanningWorkerLogFields;
export type PlanningWorkerQueue = Readonly<{
  claimNext(options: { workerOwner: string; leaseSeconds: number }): Promise<ClaimResult>;
  heartbeat(jobId: string, leaseToken: string, leaseSeconds: number): Promise<MutationResult>;
  completeSuccess(jobId: string, leaseToken: string): Promise<MutationResult>;
  scheduleRetry(jobId: string, leaseToken: string, failureCode: string, delaySeconds: number): Promise<MutationResult>;
  completeFailure(jobId: string, leaseToken: string, failureCode: string): Promise<MutationResult>;
}>;
export type GeneratePlanOptions = Readonly<{ signal?: AbortSignal; attemptId?: string }>;
export type PlanningExecutor = Readonly<{
  generatePlan(investigationId: unknown, options?: GeneratePlanOptions): Promise<PersistedInvestigationPlan>;
}>;

function leaseLost(result: MutationResult): boolean { return result.kind === "lease_lost" || result.kind === "not_found"; }

export class PlanningWorker {
  constructor(private readonly queue: PlanningWorkerQueue, private readonly planner: PlanningExecutor,
    private readonly config: Readonly<{ owner: string; leaseSeconds: number; heartbeatSeconds: number; pollMs: number } & RetryPolicyConfig>,
    private readonly logger: PlanningWorkerLogger = { info() {} }, private readonly sleep: AbortableSleep = abortableSleep) {}

  async runOnce(signal: AbortSignal): Promise<PlanningWorkerRunResult> {
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

  private async execute(claim: PlanningJobClaim, shutdown: AbortSignal): Promise<PlanningWorkerRunResult> {
    const work = new AbortController(), heartbeatStop = new AbortController();
    let lost = false;
    const stopWork = () => work.abort(shutdown.reason ?? new Error("Worker shutdown."));
    shutdown.addEventListener("abort", stopWork, { once: true });
    if (shutdown.aborted) stopWork();
    const heartbeat = this.heartbeatLoop(claim, work, heartbeatStop.signal, () => { lost = true; });
    let planningError: unknown, completed = false;
    try {
      await this.planner.generatePlan(claim.investigationId, { signal: work.signal, attemptId: claim.attemptId });
      completed = true;
    } catch (error) { planningError = error; }
    heartbeatStop.abort();
    await heartbeat;
    shutdown.removeEventListener("abort", stopWork);
    if (lost) return this.report(this.fields(claim, "lease_lost"));

    if (completed && !shutdown.aborted) {
      const finalized = await this.queue.completeSuccess(claim.jobId, claim.leaseToken);
      return this.report(this.fields(claim, finalized.kind === "updated" ||
        (finalized.kind === "already_terminal" && finalized.status === "succeeded") ? "succeeded" : "lease_lost"));
    }

    const decision = classifyPlanningJobFailure(planningError, claim.attemptNumber, claim.maxAttempts,
      { baseSeconds: this.config.baseSeconds, maximumSeconds: this.config.maximumSeconds }, shutdown.aborted);
    const mutation = decision.disposition === "retry"
      ? await this.queue.scheduleRetry(claim.jobId, claim.leaseToken, decision.failureCode, decision.delaySeconds!)
      : await this.queue.completeFailure(claim.jobId, claim.leaseToken, decision.failureCode);
    if (leaseLost(mutation) || mutation.kind !== "updated") return this.report(this.fields(claim, "lease_lost"));
    const status = decision.disposition === "retry" ? "retry_wait" : "failed";
    return this.report({ ...this.fields(claim, status), failureCode: decision.failureCode });
  }

  private async heartbeatLoop(claim: PlanningJobClaim, work: AbortController, stop: AbortSignal, lost: () => void): Promise<void> {
    while (!stop.aborted) {
      try { await this.sleep(this.config.heartbeatSeconds * 1_000, stop); } catch { return; }
      try {
        const result = await this.queue.heartbeat(claim.jobId, claim.leaseToken, this.config.leaseSeconds);
        if (result.kind !== "updated") { lost(); work.abort(new Error("Planning job lease lost.")); return; }
      } catch {
        lost(); work.abort(new Error("Planning job heartbeat failed.")); return;
      }
    }
  }

  private fields(claim: PlanningJobClaim, status: PlanningWorkerLogFields["status"]): PlanningWorkerLogFields {
    return { jobId: claim.jobId, investigationId: claim.investigationId, attemptNumber: claim.attemptNumber, status };
  }
  private report(result: PlanningWorkerRunResult): PlanningWorkerRunResult { this.logger.info("planning_job", result); return result; }
}
