import { describe, expect, it } from "vitest";
import { buildJudgeArtifactFromProviderResponse } from "./judge-normalizer";

const investigationId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";

describe("judge normalizer", () => {
  it("replaces placeholder claim ids and fills required judgment fields", () => {
    const artifact = buildJudgeArtifactFromProviderResponse({
      parsed: {
        claimJudgments: [{
          id: "judgment_key",
          claimId: "uuid",
          verdict: "partial",
          confidence: "medium",
          summary: "Summary.",
          reasoning: "Reasoning.",
        }],
        reportSummary: "Report summary.",
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.claimJudgments[0]?.claimId).toBe(claimId);
    expect(artifact.claimJudgments[0]?.verdict).toBe("unverified");
    expect(artifact.completionDisposition).toBe("completed_with_limitations");
  });
});
