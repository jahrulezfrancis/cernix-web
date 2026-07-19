import { describe, expect, it } from "vitest";
import { buildEvidenceTaskResultFromProviderResponse } from "./evidence-normalizer";

const claimId = "33333333-3333-4333-8333-333333333333";
const matches = [{
  path: "package.json",
  lineStart: 1,
  lineEnd: 3,
  normalizedSha256: "a".repeat(64),
  excerptText: "{\n  \"name\": \"demo\"\n}",
}];

describe("evidence normalizer", () => {
  it("replaces placeholder claim ids and repairs excerpts from retrieval matches", () => {
    const artifact = buildEvidenceTaskResultFromProviderResponse({
      parsed: {
        taskKey: "wrong_key",
        claimId: "uuid",
        candidates: [{
          id: "Candidate-1",
          obligationKeys: ["obl_multi_agent"],
          evidenceType: "deployment_config",
          observation: "Found package metadata.",
          excerpts: [{
            path: "package.json",
            lineStart: 1,
            lineEnd: 1,
            normalizedSha256: "deadbeef",
            excerptText: "wrong",
          }],
          strength: "high",
        }],
      },
      taskKey: "task_search_multi_agent_indicators",
      claimId,
      obligationKeys: ["obl_multi_agent"],
      retrievalMatches: matches,
    });
    expect(artifact.claimId).toBe(claimId);
    expect(artifact.taskKey).toBe("task_search_multi_agent_indicators");
    expect(artifact.candidates[0]?.evidenceType).toBe("repository_structure");
    expect(artifact.candidates[0]?.excerpts[0]?.normalizedSha256).toBe("a".repeat(64));
  });

  it("allows empty candidates when only gaps are returned", () => {
    const artifact = buildEvidenceTaskResultFromProviderResponse({
      parsed: {
        candidates: [],
        gaps: [{ id: "gap_1", obligationKeys: ["obl_cloud"], description: "No cloud SDK found.", impact: "high" }],
        counterevidence: [],
      },
      taskKey: "task_search_alibaba_cloud_artifacts",
      claimId,
      obligationKeys: ["obl_cloud"],
      retrievalMatches: [],
    });
    expect(artifact.candidates).toEqual([]);
    expect(artifact.gaps).toHaveLength(1);
  });
});
