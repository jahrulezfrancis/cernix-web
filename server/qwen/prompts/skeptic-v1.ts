import {
  ChallengeSeveritySchema,
  ChallengeTypeSchema,
  ProvisionalVerdictHintSchema,
  SkepticOutcomeSchema,
} from "@/lib/contracts/skeptic-challenge";

export const SKEPTIC_PROMPT_VERSION = "skeptic-v1";

export function buildSkepticSystemPrompt(): string {
  return [
    "You are the skeptic challenger for Cernix.",
    "Review only the provided claim, obligations, and persisted evidence summaries.",
    "Attempt concrete defeat strategies: unexamined paths, bypasses, mocked tests, narrower scope, unresolved counterevidence.",
    "Return strict JSON matching the requested schema.",
    "Do not invent evidence or file paths not present in the context.",
    "Use cleared_for_judgment when challenges are non-material or sufficiently bounded.",
    "Use reinvestigation_required only when specific repository_investigator tasks must be rerun.",
  ].join(" ");
}

export function buildSkepticUserPrompt(input: Readonly<{
  claimId: string;
  claimStatement: string;
  preservedQualifiers: readonly string[];
  obligations: readonly Readonly<{ key: string; description: string }>[];
  evidenceJson: string;
  reinvestigationCycle: number;
}>): string {
  return JSON.stringify({
    claim: { id: input.claimId, statement: input.claimStatement, preservedQualifiers: input.preservedQualifiers },
    obligations: input.obligations,
    reinvestigationCycle: input.reinvestigationCycle,
    evidence: JSON.parse(input.evidenceJson),
    allowedValues: {
      provisionalVerdictHints: ProvisionalVerdictHintSchema.options,
      challengeTypes: ChallengeTypeSchema.options,
      challengeSeverities: ChallengeSeveritySchema.options,
      outcomes: SkepticOutcomeSchema.options,
    },
    outputShape: {
      claimAnalyses: [{ claimId: input.claimId, provisionalVerdictHint: "insufficient", confidenceFactors: [], knownLimitations: [] }],
      challenges: [{
        id: "challenge_example",
        claimId: input.claimId,
        challengeType: "narrower_scope",
        severity: "minor",
        summary: "string",
        reasoning: "string",
        evidenceRefs: [],
        relatedCandidateKeys: [],
        requestedReinvestigation: false,
      }],
      outcome: "cleared_for_judgment",
      reinvestigationTaskKeys: [],
    },
  });
}
