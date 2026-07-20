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

  it("drops invalid reinvestigation task keys instead of inventing fallbacks", () => {
    const artifact = buildSkepticArtifactFromProviderResponse({
      parsed: {
        claimAnalyses: [{ claimId: "uuid", provisionalVerdictHint: "insufficient" }],
        challenges: [],
        outcome: "reinvestigation_required",
        reinvestigationTaskKeys: ["Invalid Key!", "also bad"],
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.outcome).toBe("cleared_for_judgment");
    expect(artifact.reinvestigationTaskKeys).toEqual([]);
  });

  it("truncates overlong challenge text to schema limits", () => {
    const artifact = buildSkepticArtifactFromProviderResponse({
      parsed: {
        challenges: [{
          id: "chal_long",
          challengeType: "other",
          severity: "minor",
          summary: "s".repeat(600),
          reasoning: "r".repeat(5000),
        }],
        outcome: "cleared_for_judgment",
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.challenges[0]?.summary).toHaveLength(500);
    expect(artifact.challenges[0]?.reasoning).toHaveLength(4000);
  });

  it("skips null challenge entries rather than failing the whole artifact", () => {
    const artifact = buildSkepticArtifactFromProviderResponse({
      parsed: { challenges: [null, {
        id: "chal_ok",
        challengeType: "other",
        severity: "minor",
        summary: "Ok",
        reasoning: "Valid challenge.",
      }] },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.challenges).toHaveLength(1);
    expect(artifact.challenges[0]?.id).toBe("chal_ok");
  });

  it("fails when snapshot identity cannot produce a schema-valid artifact", () => {
    expect(() => buildSkepticArtifactFromProviderResponse({
      parsed: { challenges: [] },
      investigationId,
      claimId,
      snapshotManifestHash: "not-a-hash",
      commitSha: "b".repeat(40),
    })).toThrow(PlanningError);
  });
});
