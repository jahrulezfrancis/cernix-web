import { describe, expect, it } from "vitest";
import { buildPlanningArtifactFromProviderResponse } from "./plan-normalizer";
import { PlanningError } from "./errors";

const investigationId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";

describe("plan normalizer", () => {
  it("replaces placeholder claim ids and drops invalid optional enums", () => {
    const artifact = buildPlanningArtifactFromProviderResponse({
      parsed: {
        claimPlans: [{
          claimId: "uuid",
          obligations: [{
            id: "obl_guard",
            claimId: "uuid",
            description: "Guard exists.",
            taxonomy: "security",
            priority: 1,
          }],
          evidenceTasks: [{
            id: "task_scan",
            obligationIds: ["obl_guard"],
            specialistCapability: "repository_investigator",
            expectedEvidenceTypes: ["code_implementation", "deployment_config"],
            queryTerms: ["auth"],
            priority: 1,
            dependsOnTaskIds: [],
          }],
          knownLimitations: ["Static inspection only."],
        }],
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    });
    expect(artifact.claimPlans[0]?.claimId).toBe(claimId);
    expect(artifact.claimPlans[0]?.obligations[0]?.claimId).toBe(claimId);
    expect(artifact.claimPlans[0]?.obligations[0]?.taxonomy).toBeUndefined();
    expect(artifact.claimPlans[0]?.evidenceTasks[0]?.expectedEvidenceTypes).toEqual(["code_implementation"]);
  });

  it("fails when no evidence types survive normalization", () => {
    expect(() => buildPlanningArtifactFromProviderResponse({
      parsed: {
        claimPlans: [{
          claimId: "uuid",
          obligations: [{ id: "obl_guard", claimId: "uuid", description: "Guard exists.", priority: 1 }],
          evidenceTasks: [{
            id: "task_scan",
            obligationIds: ["obl_guard"],
            specialistCapability: "repository_investigator",
            expectedEvidenceTypes: ["deployment_config"],
            priority: 1,
          }],
          knownLimitations: [],
        }],
      },
      investigationId,
      claimId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
    })).toThrow(PlanningError);
  });
});
