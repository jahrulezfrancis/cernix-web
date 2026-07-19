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
  claimStatement: string;
  preservedQualifiers: readonly string[];
  obligations: readonly Readonly<{ key: string; description: string }>[];
  skepticOutcome: string;
  challengesJson: string;
  evidenceJson: string;
}>): string {
  return JSON.stringify({
    claimStatement: input.claimStatement,
    preservedQualifiers: input.preservedQualifiers,
    obligations: input.obligations,
    skepticOutcome: input.skepticOutcome,
    challenges: JSON.parse(input.challengesJson),
    evidence: JSON.parse(input.evidenceJson),
    outputShape: {
      claimJudgments: [{
        id: "judgment_key", claimId: "uuid", verdict: "verified|partially_verified|unverified",
        confidence: "high|moderate|low", summary: "string", reasoning: "string",
      }],
      limitations: [{ id: "limitation_key", claimId: "uuid", description: "string", impact: "low|medium|high" }],
      maintainerActions: [{ id: "action_key", claimId: "uuid", action: "string", priority: "low|medium|high" }],
      reportSummary: "string",
      completionDisposition: "completed|completed_with_limitations",
    },
  });
}
