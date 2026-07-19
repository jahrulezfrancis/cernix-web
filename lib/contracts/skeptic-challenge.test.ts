import { describe, expect, it } from "vitest";
import { SkepticArtifactSchema, SKEPTIC_SCHEMA_VERSION } from "./skeptic-challenge";

const claimId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const investigationId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function validArtifact() {
  return {
    schemaVersion: SKEPTIC_SCHEMA_VERSION,
    investigationId,
    snapshotManifestHash: "a".repeat(64),
    commitSha: "b".repeat(40),
    claimAnalyses: [{
      claimId,
      provisionalVerdictHint: "weakly_supports" as const,
      confidenceFactors: ["README evidence is present."],
      knownLimitations: ["Static inspection only."],
    }],
    challenges: [{
      id: "chal_readme_scope",
      claimId,
      challengeType: "narrower_scope" as const,
      severity: "minor" as const,
      summary: "README presence does not prove runtime behavior.",
      reasoning: "The cited evidence only shows repository structure.",
      evidenceRefs: [{ candidateKey: "cand_readme", obligationKeys: ["obl_readme"] }],
      relatedCandidateKeys: ["cand_readme"],
      requestedReinvestigation: false,
    }],
    outcome: "cleared_for_judgment" as const,
    reinvestigationTaskKeys: [],
  };
}

describe("skeptic challenge contracts", () => {
  it("accepts a valid skeptic artifact", () => {
    expect(SkepticArtifactSchema.parse(validArtifact()).challenges).toHaveLength(1);
  });

  it("rejects unknown keys and inconsistent reinvestigation outcomes", () => {
    expect(() => SkepticArtifactSchema.parse({ ...validArtifact(), extra: true })).toThrow();
    expect(() => SkepticArtifactSchema.parse({
      ...validArtifact(),
      outcome: "reinvestigation_required",
      reinvestigationTaskKeys: [],
    })).toThrow();
    expect(() => SkepticArtifactSchema.parse({
      ...validArtifact(),
      outcome: "cleared_for_judgment",
      reinvestigationTaskKeys: ["task_readme"],
    })).toThrow();
  });
});
