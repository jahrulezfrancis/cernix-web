import { describe, expect, it } from "vitest";
import {
  JudgeArtifactSchema,
  JUDGE_SCHEMA_VERSION,
  canonicalizeJudgeArtifact,
  deriveCompletionDisposition,
  hashJudgeArtifact,
  validateJudgeArtifact,
} from "./judgment-report";

const claimId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const investigationId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function validArtifact() {
  return {
    schemaVersion: JUDGE_SCHEMA_VERSION,
    investigationId,
    snapshotManifestHash: "a".repeat(64),
    commitSha: "b".repeat(40),
    claimJudgments: [{
      id: "judgment_readme",
      claimId,
      verdict: "partially_verified" as const,
      confidence: "moderate" as const,
      summary: "README evidence supports structure only.",
      reasoning: "The inspected repository contains a README, but runtime behavior is not demonstrated.",
      confidenceFactors: ["README excerpt is present."],
      unprovenAspects: ["Runtime behavior."],
      whatCouldChangeVerdict: ["Add integration tests covering the claimed behavior."],
    }],
    limitations: [{
      id: "lim_static_only",
      claimId,
      description: "Inspection was limited to static repository content.",
      impact: "medium" as const,
    }],
    maintainerActions: [{
      id: "act_add_tests",
      claimId,
      action: "Add an integration test that exercises the claimed behavior.",
      priority: "high" as const,
    }],
    reportSummary: "The claim is only partially supported by repository structure evidence.",
    completionDisposition: "completed_with_limitations" as const,
  };
}

describe("judgment report contracts", () => {
  it("accepts a valid judge artifact", () => {
    expect(JudgeArtifactSchema.parse(validArtifact()).claimJudgments).toHaveLength(1);
  });

  it("rejects inconsistent completion disposition", () => {
    expect(() => JudgeArtifactSchema.parse({
      ...validArtifact(),
      claimJudgments: [{ ...validArtifact().claimJudgments[0], verdict: "verified" }],
      completionDisposition: "completed_with_limitations",
    })).not.toThrow();
    expect(() => JudgeArtifactSchema.parse({
      ...validArtifact(),
      claimJudgments: [{ ...validArtifact().claimJudgments[0], verdict: "unverified" }],
      completionDisposition: "completed",
    })).toThrow();
  });

  it("canonicalizes artifacts deterministically", () => {
    const artifact = validateJudgeArtifact(validArtifact());
    const hash = hashJudgeArtifact(artifact);
    expect(hash).toHaveLength(64);
    expect(canonicalizeJudgeArtifact(artifact)).toContain("\"schemaVersion\":1");
    expect(deriveCompletionDisposition(artifact)).toBe("completed_with_limitations");
  });
});
