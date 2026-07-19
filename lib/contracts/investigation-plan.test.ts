import { describe, expect, it } from "vitest";
import {
  InvestigationPlanArtifactSchema,
  PLAN_SCHEMA_VERSION,
} from "./investigation-plan";

const claimId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const investigationId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

function validClaimPlan() {
  return {
    claimId,
    obligations: [{
      id: "obl_auth_guard",
      claimId,
      description: "Every administrative route uses the shared authorization guard.",
      taxonomy: "security_control" as const,
      priority: 1,
    }],
    evidenceTasks: [{
      id: "task_route_scan",
      obligationIds: ["obl_auth_guard"],
      specialistCapability: "repository_investigator" as const,
      expectedEvidenceTypes: ["code_implementation" as const],
      queryTerms: ["authorization", "admin"],
      priority: 1,
      dependsOnTaskIds: [],
    }],
    knownLimitations: ["Static inspection cannot prove runtime enforcement."],
  };
}

describe("investigation plan contracts", () => {
  it("accepts a valid bounded artifact", () => {
    const artifact = InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [validClaimPlan()],
    });
    expect(artifact.claimPlans).toHaveLength(1);
  });

  it("rejects unknown keys and empty obligations or tasks", () => {
    expect(() => InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [{ ...validClaimPlan(), extra: true }],
    })).toThrow();
    expect(() => InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [{ ...validClaimPlan(), obligations: [] }],
    })).toThrow();
    expect(() => InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [{ ...validClaimPlan(), evidenceTasks: [] }],
    })).toThrow();
  });

  it("rejects invalid DAG references", () => {
    expect(() => InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [{
        ...validClaimPlan(),
        evidenceTasks: [{
          id: "task_route_scan",
          obligationIds: ["missing_obligation"],
          specialistCapability: "repository_investigator",
          expectedEvidenceTypes: ["code_implementation"],
          queryTerms: [],
          priority: 1,
          dependsOnTaskIds: [],
        }],
      }],
    })).toThrow();
    expect(() => InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [{
        ...validClaimPlan(),
        evidenceTasks: [{
          id: "task_route_scan",
          obligationIds: ["obl_auth_guard"],
          specialistCapability: "repository_investigator",
          expectedEvidenceTypes: ["code_implementation"],
          queryTerms: [],
          priority: 1,
          dependsOnTaskIds: ["task_route_scan"],
        }],
      }],
    })).toThrow();
  });

  it("rejects cyclic task dependencies", () => {
    expect(() => InvestigationPlanArtifactSchema.parse({
      schemaVersion: PLAN_SCHEMA_VERSION,
      investigationId,
      snapshotManifestHash: "a".repeat(64),
      commitSha: "b".repeat(40),
      claimPlans: [{
        ...validClaimPlan(),
        evidenceTasks: [
          {
            id: "task_a",
            obligationIds: ["obl_auth_guard"],
            specialistCapability: "repository_investigator",
            expectedEvidenceTypes: ["code_implementation"],
            queryTerms: [],
            priority: 1,
            dependsOnTaskIds: ["task_b"],
          },
          {
            id: "task_b",
            obligationIds: ["obl_auth_guard"],
            specialistCapability: "repository_investigator",
            expectedEvidenceTypes: ["code_implementation"],
            queryTerms: [],
            priority: 2,
            dependsOnTaskIds: ["task_a"],
          },
        ],
      }],
    })).toThrow();
  });
});
