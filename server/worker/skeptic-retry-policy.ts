import { PlanningError, type PlanningFailureCode } from "@/server/qwen/errors";
import type { RetryPolicyConfig, RetryDecision } from "./evidence-retry-policy";
import { classifyEvidenceJobFailure } from "./evidence-retry-policy";

const TERMINAL_CODES = new Set<PlanningFailureCode>([
  "skeptic_schema_invalid", "skeptic_context_invalid",
]);

export function classifySkepticJobFailure(error: unknown, attemptNumber: number, maxAttempts: number,
  config: RetryPolicyConfig, interrupted = false): RetryDecision {
  if (error instanceof PlanningError && TERMINAL_CODES.has(error.failureCode)) {
    return { disposition: "fail", failureCode: error.failureCode, delaySeconds: null };
  }
  return classifyEvidenceJobFailure(error, attemptNumber, maxAttempts, config, interrupted);
}
