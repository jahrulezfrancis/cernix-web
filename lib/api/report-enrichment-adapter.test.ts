import { describe, expect, it } from "vitest";
import {
  mapArtifactLimitationsToGaps,
  mapEvidenceBundleToReport,
  mapSkepticArtifactToChallenges,
} from "./report-enrichment-adapter";

describe("report enrichment adapter", () => {
  it("maps persisted evidence candidates into report evidence items", () => {
    const mapped = mapEvidenceBundleToReport({
      tasks: [{
        taskKey: "task_readme",
        status: "succeeded",
        specialistCapability: "repository_investigator",
        claimId: "00000000-0000-4000-8000-000000000010",
        candidates: [{
          candidateKey: "cand_readme",
          evidenceType: "repository_structure",
          strength: "moderate",
          observation: "README describes test setup.",
          commitSha: "abcdef1234567890abcdef1234567890abcdef12",
          excerpts: [{
            path: "README.md",
            lineStart: 1,
            lineEnd: 3,
            excerptText: "# Widget",
          }],
        }],
        gaps: [],
        counterevidence: [],
      }],
    }, "00000000-0000-4000-8000-000000000001");

    const claimId = "00000000-0000-4000-8000-000000000010";
    expect(mapped.evidence[claimId]).toHaveLength(1);
    expect(mapped.evidence[claimId][0]?.repositoryPath).toBe("README.md");
    expect(mapped.evidence[claimId][0]?.codeExcerpt).toBe("# Widget");
  });

  it("maps artifact limitations into evidence gaps", () => {
    const gaps = mapArtifactLimitationsToGaps([{
      id: "lim_1",
      claimId: "00000000-0000-4000-8000-000000000010",
      description: "Branch protection settings were unavailable.",
      impact: "high",
    }]);

    expect(gaps["00000000-0000-4000-8000-000000000010"]).toHaveLength(1);
    expect(gaps["00000000-0000-4000-8000-000000000010"][0]?.impactOnVerdict).toContain("high");
  });

  it("maps skeptic challenges for the review tab", () => {
    const challenges = mapSkepticArtifactToChallenges({
      schemaVersion: 1,
      investigationId: "00000000-0000-4000-8000-000000000001",
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      outcome: "cleared_for_judgment",
      claimAnalyses: [{
        claimId: "00000000-0000-4000-8000-000000000010",
        provisionalVerdictHint: "weakly_supports",
        confidenceFactors: [],
        knownLimitations: [],
      }],
      reinvestigationTaskKeys: [],
      challenges: [{
        id: "challenge_1",
        claimId: "00000000-0000-4000-8000-000000000010",
        challengeType: "missing_obligation",
        severity: "major",
        summary: "Test coverage claim is weak.",
        reasoning: "Only one test file was found.",
        evidenceRefs: [],
        relatedCandidateKeys: [],
        requestedReinvestigation: false,
      }],
    });

    expect(challenges["00000000-0000-4000-8000-000000000010"]).toHaveLength(1);
    expect(challenges["00000000-0000-4000-8000-000000000010"][0]?.challengeText).toContain("weak");
  });
});
