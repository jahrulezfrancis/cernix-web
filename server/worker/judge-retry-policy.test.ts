import { describe, expect, it } from "vitest";
import { PlanningError } from "@/server/qwen/errors";
import { classifyJudgeJobFailure } from "./judge-retry-policy";

describe("judge worker retry policy", () => {
  const config = { baseSeconds: 5, maximumSeconds: 300 };

  it("fails terminally on judge schema and context errors", () => {
    expect(classifyJudgeJobFailure(new PlanningError("judge_schema_invalid"), 1, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "judge_schema_invalid" });
    expect(classifyJudgeJobFailure(new PlanningError("judge_context_invalid"), 1, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "judge_context_invalid" });
  });

  it("retries transient provider failures", () => {
    expect(classifyJudgeJobFailure(new PlanningError("qwen_rate_limited"), 1, 4, config))
      .toMatchObject({ disposition: "retry", failureCode: "qwen_rate_limited", delaySeconds: 5 });
  });
});
