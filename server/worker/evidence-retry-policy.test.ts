import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { PlanningError } from "@/server/qwen/errors";
import { classifyEvidenceJobFailure } from "./evidence-retry-policy";

describe("evidence worker retry policy", () => {
  const config = { baseSeconds: 5, maximumSeconds: 300 };

  it("classifies retryable provider failures and terminal schema errors", () => {
    expect(classifyEvidenceJobFailure(new PlanningError("qwen_rate_limited"), 1, 4, config))
      .toMatchObject({ disposition: "retry", failureCode: "qwen_rate_limited", delaySeconds: 5 });
    expect(classifyEvidenceJobFailure(new PlanningError("evidence_schema_invalid"), 1, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "evidence_schema_invalid" });
    expect(classifyEvidenceJobFailure(new ApplicationError("dependency_unavailable", {}), 2, 4, config))
      .toMatchObject({ disposition: "retry", delaySeconds: 10 });
  });

  it("fails closed when attempts are exhausted", () => {
    expect(classifyEvidenceJobFailure(new PlanningError("qwen_unavailable"), 4, 4, config))
      .toMatchObject({ disposition: "fail", failureCode: "attempts_exhausted" });
  });
});
