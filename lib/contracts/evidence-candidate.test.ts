import { describe, expect, it } from "vitest";
import { EvidenceTaskResultSchema, EVIDENCE_SCHEMA_VERSION, InvestigationEvidenceArtifactSchema } from "./evidence-candidate";

const claimId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const investigationId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function validResult() {
  return {
    taskKey: "task_readme",
    claimId,
    candidates: [{
      id: "cand_readme",
      obligationKeys: ["obl_readme"],
      evidenceType: "repository_structure" as const,
      observation: "README.md exists at repository root.",
      excerpts: [{
        path: "README.md",
        lineStart: 1,
        lineEnd: 1,
        normalizedSha256: "a".repeat(64),
        excerptText: "# Widget",
      }],
      strength: "moderate" as const,
    }],
    gaps: [],
    counterevidence: [],
  };
}

describe("evidence candidate contracts", () => {
  it("accepts a valid task result", () => {
    expect(EvidenceTaskResultSchema.parse(validResult()).candidates).toHaveLength(1);
  });

  it("rejects unknown keys and invalid excerpt ranges", () => {
    expect(() => EvidenceTaskResultSchema.parse({ ...validResult(), extra: true })).toThrow();
    expect(() => EvidenceTaskResultSchema.parse({
      ...validResult(),
      candidates: [{ ...validResult().candidates[0], excerpts: [{ ...validResult().candidates[0].excerpts[0], lineStart: 5, lineEnd: 1 }] }],
    })).toThrow();
  });

  it("accepts a bounded investigation evidence artifact", () => {
    const artifact = InvestigationEvidenceArtifactSchema.parse({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      taskResults: [validResult()],
    });
    expect(artifact.taskResults).toHaveLength(1);
  });
});
