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
  | "plan_deadline_exceeded";

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
};

export class PlanningError extends ApplicationError {
  readonly failureCode: PlanningFailureCode;
  constructor(failureCode: PlanningFailureCode, cause?: unknown) {
    super(PUBLIC_CODE[failureCode], { cause });
    this.name = "PlanningError";
    this.failureCode = failureCode;
  }
}
