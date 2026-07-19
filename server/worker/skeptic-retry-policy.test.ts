import { describe, expect, it } from "vitest";
import { PlanningError } from "@/server/qwen/errors";
import { classifySkepticJobFailure } from "./skeptic-retry-policy";

const config = { baseSeconds: 5, maximumSeconds: 300 };

describe("skeptic retry policy", () => {
  it("fails terminally on schema and context errors", () => {
    expect(classifySkepticJobFailure(new PlanningError("skeptic_schema_invalid"), 1, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "skeptic_schema_invalid" });
    expect(classifySkepticJobFailure(new PlanningError("skeptic_context_invalid"), 1, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "skeptic_context_invalid" });
  });

  it("retries transient provider failures", () => {
    expect(classifySkepticJobFailure(new PlanningError("qwen_rate_limited"), 1, 4, config))
      .toMatchObject({ disposition: "retry", failureCode: "qwen_rate_limited", delaySeconds: 5 });
  });
});
