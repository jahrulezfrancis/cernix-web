import {
  EvidenceTypeSchema,
  ObligationTaxonomySchema,
  SpecialistCapabilitySchema,
  PLAN_SCHEMA_VERSION,
  validateInvestigationPlanArtifact,
  type InvestigationPlanArtifact,
} from "@/lib/contracts/investigation-plan";
import { PlanningError } from "./errors";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningError("plan_schema_invalid");
  return value as Record<string, unknown>;
}

function normalizeObligation(raw: unknown, claimId: string): Record<string, unknown> {
  const obligation = asRecord(raw);
  const { taxonomy: _ignored, claimId: _claimId, ...rest } = obligation;
  const taxonomy = ObligationTaxonomySchema.safeParse(_ignored);
  return {
    ...rest,
    claimId,
    ...(taxonomy.success ? { taxonomy: taxonomy.data } : {}),
  };
}

function normalizeEvidenceTask(raw: unknown): Record<string, unknown> {
  const task = asRecord(raw);
  const { expectedEvidenceTypes: rawTypes, specialistCapability: rawCapability, ...rest } = task;
  const expectedEvidenceTypes = Array.isArray(rawTypes)
    ? rawTypes.flatMap((value) => {
        const parsed = EvidenceTypeSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  if (expectedEvidenceTypes.length < 1) throw new PlanningError("plan_schema_invalid");
  const specialistCapability = SpecialistCapabilitySchema.safeParse(rawCapability);
  return {
    ...rest,
    expectedEvidenceTypes,
    specialistCapability: specialistCapability.success ? specialistCapability.data : "repository_investigator",
  };
}

function normalizeClaimPlan(raw: unknown, claimId: string): Record<string, unknown> {
  const plan = asRecord(raw);
  const { claimId: _claimId, obligations, evidenceTasks, ...rest } = plan;
  if (!Array.isArray(obligations) || !Array.isArray(evidenceTasks)) {
    throw new PlanningError("plan_schema_invalid");
  }
  return {
    ...rest,
    claimId,
    obligations: obligations.map((obligation) => normalizeObligation(obligation, claimId)),
    evidenceTasks: evidenceTasks.map((task) => normalizeEvidenceTask(task)),
  };
}

export function buildPlanningArtifactFromProviderResponse(params: Readonly<{
  parsed: unknown;
  investigationId: string;
  claimId: string;
  snapshotManifestHash: string;
  commitSha: string;
}>): InvestigationPlanArtifact {
  const claimPlans = params.parsed && typeof params.parsed === "object" && "claimPlans" in params.parsed
    ? (params.parsed as { claimPlans: unknown }).claimPlans
    : params.parsed;
  if (!Array.isArray(claimPlans)) throw new PlanningError("plan_schema_invalid");
  const rawArtifact = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    investigationId: params.investigationId,
    snapshotManifestHash: params.snapshotManifestHash,
    commitSha: params.commitSha,
    claimPlans: claimPlans.map((plan) => normalizeClaimPlan(plan, params.claimId)),
  };
  try {
    return validateInvestigationPlanArtifact(rawArtifact);
  } catch (error) {
    throw new PlanningError("plan_schema_invalid", error);
  }
}
