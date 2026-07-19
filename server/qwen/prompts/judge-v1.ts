import {
  CompletionDispositionSchema,
  ConfidenceSchema,
  UserVerdictSchema,
} from "@/lib/contracts/judgment-report";

export const JUDGE_PROMPT_VERSION = "judge-v1";

export function buildJudgeSystemPrompt(): string {
  return [
    "You are the evidence judge for Cernix.",
    "Issue bounded final judgments using only the provided claim, obligations, evidence, and skeptic challenges.",
    "Map outcomes to verified, partially_verified, or unverified.",
    "Use completed_with_limitations when any claim is not fully verified.",
    "Do not invent evidence or strengthen claims beyond the inspected repository snapshot.",
    "Return strict JSON matching the requested schema.",
  ].join(" ");
}

export function buildJudgeUserPrompt(input: Readonly<{
  claimId: string;
  claimStatement: string;
  preservedQualifiers: readonly string[];
  obligations: readonly Readonly<{ key: string; description: string }>[];
  skepticOutcome: string;
  challengesJson: string;
  evidenceJson: string;
}>): string {
  return JSON.stringify({
    claim: { id: input.claimId, statement: input.claimStatement, preservedQualifiers: input.preservedQualifiers },
    obligations: input.obligations,
    skepticOutcome: input.skepticOutcome,
    challenges: JSON.parse(input.challengesJson),
    evidence: JSON.parse(input.evidenceJson),
    allowedValues: {
      verdicts: UserVerdictSchema.options,
      confidenceLevels: ConfidenceSchema.options,
      completionDispositions: CompletionDispositionSchema.options,
    },
    outputShape: {
      claimJudgments: [{
        id: "judgment_example",
        claimId: input.claimId,
        verdict: "partially_verified",
        confidence: "moderate",
        summary: "string",
        reasoning: "string",
        confidenceFactors: [],
        unprovenAspects: [],
        whatCouldChangeVerdict: [],
      }],
      limitations: [{ id: "limitation_example", claimId: input.claimId, description: "string", impact: "medium" }],
      maintainerActions: [{ id: "action_example", claimId: input.claimId, action: "string", priority: "medium" }],
      reportSummary: "string",
      completionDisposition: "completed_with_limitations",
    },
  });
}
