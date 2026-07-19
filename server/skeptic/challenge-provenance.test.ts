import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { buildEvidenceIndex, validateChallengeEvidenceRefs, validateReinvestigationTaskKeys } from "./challenge-provenance";
import type { SkepticArtifact } from "@/lib/contracts/skeptic-challenge";
import { SKEPTIC_SCHEMA_VERSION } from "@/lib/contracts/skeptic-challenge";

const claimId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const investigationId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const artifact: SkepticArtifact = {
  schemaVersion: SKEPTIC_SCHEMA_VERSION, investigationId,
  snapshotManifestHash: "a".repeat(64), commitSha: "b".repeat(40),
  claimAnalyses: [{ claimId, provisionalVerdictHint: "weakly_supports", confidenceFactors: [], knownLimitations: [] }],
  challenges: [{
    id: "chal_scope", claimId, challengeType: "narrower_scope", severity: "minor",
    summary: "Scope is narrow.", reasoning: "README only.", evidenceRefs: [{
      candidateKey: "cand_readme", path: "README.md", lineStart: 1, lineEnd: 1, obligationKeys: [],
    }], relatedCandidateKeys: ["cand_readme"], requestedReinvestigation: false,
  }],
  outcome: "cleared_for_judgment", reinvestigationTaskKeys: [],
};

describe("challenge provenance", () => {
  const index = buildEvidenceIndex([{ candidate_key: "cand_readme", path: "README.md", line_start: 1, line_end: 1 }]);

  it("accepts grounded challenge references", () => {
    expect(() => validateChallengeEvidenceRefs(artifact, index)).not.toThrow();
  });

  it("rejects unknown candidate keys", () => {
    expect(() => validateChallengeEvidenceRefs({
      ...artifact,
      challenges: [{ ...artifact.challenges[0], evidenceRefs: [{ candidateKey: "missing", obligationKeys: [] }] }],
    }, index)).toThrow(ApplicationError);
  });
});

describe("reinvestigation task keys", () => {
  const runs = [{ task_key: "task_readme", specialist_capability: "repository_investigator" }];

  it("accepts grounded reinvestigation task keys", () => {
    expect(() => validateReinvestigationTaskKeys({
      ...artifact, outcome: "reinvestigation_required", reinvestigationTaskKeys: ["task_readme"],
    }, runs)).not.toThrow();
  });

  it("rejects unknown or non-investigator task keys", () => {
    expect(() => validateReinvestigationTaskKeys({
      ...artifact, outcome: "reinvestigation_required", reinvestigationTaskKeys: ["missing_task"],
    }, runs)).toThrow(ApplicationError);
  });
});
