import type { InvestigationClaimPlan } from "@/lib/contracts/investigation-plan";
import {
  EvidenceTypeSchema,
  ObligationTaxonomySchema,
  SpecialistCapabilitySchema,
} from "@/lib/contracts/investigation-plan";

export const PLANNING_PROMPT_VERSION = "planning-v1" as const;

export type PlanningPromptInput = Readonly<{
  claimId: string;
  claimStatement: string;
  preservedQualifiers: readonly string[];
  snapshotSummaryJson: string;
}>;

export function buildPlanningSystemPrompt(): string {
  return [
    "You are Cernix investigation planner.",
    "Decompose the claim into verification obligations and evidence tasks for a static repository snapshot.",
    "Return only valid JSON matching the requested schema.",
    "Do not invent evidence, verdicts, or runtime guarantees.",
    "Use stable lowercase snake_case identifiers for obligation and task ids.",
    "Each evidence task must reference at least one obligation id.",
    "Known limitations must acknowledge static snapshot boundaries.",
  ].join(" ");
}

export function buildPlanningUserPrompt(input: PlanningPromptInput): string {
  return JSON.stringify({
    instruction: "Produce an investigation claim plan.",
    claim: { id: input.claimId, statement: input.claimStatement, preservedQualifiers: input.preservedQualifiers },
    snapshotSummary: JSON.parse(input.snapshotSummaryJson),
    allowedValues: {
      obligationTaxonomies: ObligationTaxonomySchema.options,
      specialistCapabilities: SpecialistCapabilitySchema.options,
      evidenceTypes: EvidenceTypeSchema.options,
    },
    outputSchema: {
      claimPlans: [{
        claimId: input.claimId,
        obligations: [{ id: "obl_example", claimId: input.claimId, description: "string", taxonomy: "security_control", priority: 1 }],
        evidenceTasks: [{
          id: "task_example",
          obligationIds: ["obl_example"],
          specialistCapability: "repository_investigator",
          expectedEvidenceTypes: ["code_implementation"],
          queryTerms: ["keyword"],
          priority: 1,
          dependsOnTaskIds: [],
        }],
        knownLimitations: ["string"],
        plannerNotes: "optional string",
      }],
    } satisfies { claimPlans: InvestigationClaimPlan[] },
  });
}
