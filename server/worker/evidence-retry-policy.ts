import { ApplicationError } from "@/server/errors";
import { PlanningError, type PlanningFailureCode } from "@/server/qwen/errors";

export type RetryPolicyConfig = Readonly<{ baseSeconds: number; maximumSeconds: number }>;
export type RetryDecision = Readonly<{ disposition: "retry" | "fail"; failureCode: string; delaySeconds: number | null }>;

const RETRYABLE_CODES = new Set<PlanningFailureCode>([
  "qwen_rate_limited", "qwen_unavailable", "qwen_timeout", "plan_deadline_exceeded",
]);

function boundedDelay(attemptNumber: number, config: RetryPolicyConfig): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 10 ||
      !Number.isInteger(config.baseSeconds) || config.baseSeconds < 1 ||
      !Number.isInteger(config.maximumSeconds) || config.maximumSeconds < config.baseSeconds) {
    throw new Error("Invalid retry policy input.");
  }
  return Math.min(config.maximumSeconds, config.baseSeconds * (2 ** (attemptNumber - 1)));
}

export function classifyEvidenceJobFailure(error: unknown, attemptNumber: number, maxAttempts: number,
  config: RetryPolicyConfig, interrupted = false): RetryDecision {
  const exhausted = !Number.isInteger(maxAttempts) || maxAttempts < 1 || attemptNumber >= maxAttempts;
  let retryable = false, failureCode = "internal_error";
  if (interrupted) {
    retryable = true; failureCode = "worker_shutdown";
  } else if (error instanceof PlanningError) {
    retryable = RETRYABLE_CODES.has(error.failureCode);
    failureCode = error.failureCode;
  } else if (error instanceof ApplicationError) {
    retryable = error.code === "dependency_unavailable" || error.code === "rate_limited" || error.code === "internal_error";
    failureCode = error.code;
  }
  if (!retryable || exhausted) return { disposition: "fail", failureCode: exhausted && retryable ? "attempts_exhausted" : failureCode, delaySeconds: null };
  return { disposition: "retry", failureCode, delaySeconds: boundedDelay(attemptNumber, config) };
}
