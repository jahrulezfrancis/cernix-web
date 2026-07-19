import { describe, expect, it } from "vitest";
import { buildSkepticArtifactFromProviderResponse } from "./skeptic-normalizer";
import { PlanningError } from "./errors";

const investigationId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";

describe("skeptic normalizer", () => {
  it("replaces placeholder claim ids and maps invalid challenge enums", () => {
    const artifact = buildSkepticArtifactFromProviderResponse({
      parsed: {
        claimAnalyses: [{ claimId: "uuid", provisionalVerdictHint: "insufficient" }],
        challenges: [{
          id: "ch1_multi_agent_unverified",
          claimId: "uuid",
          challengeType: "absence_of_evidence",
          severity: "critical",
          summary: "No evidence found.",
          reasoning: "Investigation returned no candidates.",
        }],
        outcome: "cleared_for_judgment",
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.claimAnalyses[0]?.claimId).toBe(claimId);
    expect(artifact.challenges[0]?.claimId).toBe(claimId);
    expect(artifact.challenges[0]?.challengeType).toBe("other");
    expect(artifact.outcome).toBe("cleared_for_judgment");
  });

  it("requires reinvestigation task keys when outcome requests reinvestigation", () => {
    const artifact = buildSkepticArtifactFromProviderResponse({
      parsed: {
        claimAnalyses: [{ claimId: "uuid", provisionalVerdictHint: "insufficient" }],
        challenges: [],
        outcome: "reinvestigation_required",
        reinvestigationTaskKeys: ["task_scan"],
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.outcome).toBe("reinvestigation_required");
    expect(artifact.reinvestigationTaskKeys).toEqual(["task_scan"]);
  });

  it("fails when challenge content cannot be normalized into valid text", () => {
    expect(() => buildSkepticArtifactFromProviderResponse({
      parsed: { challenges: [null] },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    })).toThrow(PlanningError);
  });
});
