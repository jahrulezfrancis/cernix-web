import type { InvestigationClaimPlan } from "@/lib/contracts/investigation-plan";

export const PLANNING_PROMPT_VERSION = "planning-v1" as const;

export type PlanningPromptInput = Readonly<{
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
    claim: { statement: input.claimStatement, preservedQualifiers: input.preservedQualifiers },
    snapshotSummary: JSON.parse(input.snapshotSummaryJson),
    outputSchema: {
      claimPlans: [{
        claimId: "uuid",
        obligations: [{ id: "obl_example", claimId: "uuid", description: "string", taxonomy: "security_control", priority: 1 }],
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
