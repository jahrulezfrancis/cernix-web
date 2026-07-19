import { ApplicationError } from "@/server/errors";

export type PlanningFailureCode =
  | "qwen_authentication_failed"
  | "qwen_rate_limited"
  | "qwen_unavailable"
  | "qwen_timeout"
  | "qwen_malformed_response"
  | "qwen_context_too_large"
  | "qwen_output_too_large"
  | "plan_schema_invalid"
  | "plan_context_invalid"
  | "plan_deadline_exceeded"
  | "evidence_schema_invalid"
  | "evidence_context_invalid"
  | "skeptic_schema_invalid"
  | "skeptic_context_invalid"
  | "judge_schema_invalid"
  | "judge_context_invalid";

const PUBLIC_CODE: Record<PlanningFailureCode, ConstructorParameters<typeof ApplicationError>[0]> = {
  qwen_authentication_failed: "dependency_unavailable",
  qwen_rate_limited: "rate_limited",
  qwen_unavailable: "dependency_unavailable",
  qwen_timeout: "dependency_unavailable",
  qwen_malformed_response: "dependency_unavailable",
  qwen_context_too_large: "malformed_input",
  qwen_output_too_large: "dependency_unavailable",
  plan_schema_invalid: "internal_error",
  plan_context_invalid: "internal_error",
  plan_deadline_exceeded: "dependency_unavailable",
  evidence_schema_invalid: "internal_error",
  evidence_context_invalid: "internal_error",
  skeptic_schema_invalid: "internal_error",
  skeptic_context_invalid: "internal_error",
  judge_schema_invalid: "internal_error",
  judge_context_invalid: "internal_error",
};

export class PlanningError extends ApplicationError {
  readonly failureCode: PlanningFailureCode;
  constructor(failureCode: PlanningFailureCode, cause?: unknown) {
    super(PUBLIC_CODE[failureCode], { cause });
    this.name = "PlanningError";
    this.failureCode = failureCode;
  }
}
