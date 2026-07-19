import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { validateJudgeClaimCoverage } from "./judge-provenance";
import { JUDGE_SCHEMA_VERSION } from "@/lib/contracts/judgment-report";

describe("judge provenance", () => {
  it("requires judgments for every claim", () => {
    const claimId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    expect(() => validateJudgeClaimCoverage({
      schemaVersion: JUDGE_SCHEMA_VERSION,
      investigationId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimJudgments: [{
        id: "judgment_readme", claimId,
        verdict: "verified", confidence: "high",
        summary: "Supported.", reasoning: "Evidence supports the claim.",
        confidenceFactors: [], unprovenAspects: [], whatCouldChangeVerdict: [],
      }],
      limitations: [],
      maintainerActions: [],
      reportSummary: "Verified.",
      completionDisposition: "completed",
    }, [claimId])).not.toThrow();
    expect(() => validateJudgeClaimCoverage({
      schemaVersion: JUDGE_SCHEMA_VERSION,
      investigationId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimJudgments: [],
      limitations: [],
      maintainerActions: [],
      reportSummary: "Missing.",
      completionDisposition: "completed_with_limitations",
    }, [claimId])).toThrow(ApplicationError);
  });
});
