import { describe, expect, it } from "vitest";
import { classifyPlanningJobFailure } from "./planning-retry-policy";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "@/server/qwen/errors";

describe("planning worker retry policy", () => {
  const config = { baseSeconds: 5, maximumSeconds: 300 };

  it("classifies public codes without inspecting message text", () => {
    expect(classifyPlanningJobFailure(new ApplicationError("dependency_unavailable", {}), 1, 4, config))
      .toMatchObject({ disposition: "retry", failureCode: "dependency_unavailable", delaySeconds: 5 });
    expect(classifyPlanningJobFailure(new PlanningError("qwen_rate_limited"), 2, 4, config))
      .toMatchObject({ disposition: "retry", failureCode: "qwen_rate_limited", delaySeconds: 10 });
    expect(classifyPlanningJobFailure(new PlanningError("plan_context_invalid"), 1, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "plan_context_invalid" });
  });

  it("uses persisted attempts for deterministic capped backoff and exhaustion", () => {
    expect(classifyPlanningJobFailure(new PlanningError("qwen_unavailable"), 4, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "attempts_exhausted" });
    expect(classifyPlanningJobFailure(new PlanningError("qwen_unavailable"), 3, 4, config))
      .toMatchObject({ disposition: "retry", delaySeconds: 20 });
  });

  it("classifies owned shutdown as a bounded retry unless exhausted", () => {
    expect(classifyPlanningJobFailure(new Error("shutdown"), 1, 4, config, true))
      .toMatchObject({ disposition: "retry", failureCode: "worker_shutdown" });
  });
});
