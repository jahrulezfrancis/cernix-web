import { describe, expect, it } from "vitest";
import { hashJudgeArtifact, validateJudgeArtifact } from "@/lib/contracts/judgment-report";
import { verifyPersistedReportArtifact } from "./report-replay";

describe("report replay", () => {
  it("verifies persisted artifact hashes", () => {
    const artifact = validateJudgeArtifact({
      schemaVersion: 1,
      investigationId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimJudgments: [{
        id: "judgment_readme", claimId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        verdict: "partially_verified", confidence: "moderate",
        summary: "Partial support.", reasoning: "Evidence is narrow.",
        confidenceFactors: [], unprovenAspects: [], whatCouldChangeVerdict: [],
      }],
      limitations: [],
      maintainerActions: [],
      reportSummary: "Partial support only.",
      completionDisposition: "completed_with_limitations",
    });
    const hash = hashJudgeArtifact(artifact);
    expect(verifyPersistedReportArtifact({
      investigation_id: artifact.investigationId,
      manifest_hash_sha256: artifact.snapshotManifestHash,
      commit_sha: artifact.commitSha,
      completion_disposition: artifact.completionDisposition,
      report_summary: artifact.reportSummary,
      artifact_hash_sha256: hash,
      canonical_artifact: artifact,
    })).toEqual(artifact);
  });
});
