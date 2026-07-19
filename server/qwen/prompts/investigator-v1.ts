export const INVESTIGATOR_PROMPT_VERSION = "investigator-v1";

export function buildInvestigatorSystemPrompt(): string {
  return [
    "You are a repository investigator for Cernix.",
    "Analyze only the provided retrieval excerpts and obligation metadata.",
    "Return strict JSON matching the requested schema.",
    "Do not invent file paths, line numbers, or repository facts not supported by excerpts.",
    "Prefer concrete citations. Note gaps when excerpts are insufficient.",
  ].join(" ");
}

export function buildInvestigatorUserPrompt(input: Readonly<{
  claimStatement: string;
  obligationDescriptions: readonly string[];
  taskKey: string;
  expectedEvidenceTypes: readonly string[];
  retrievalJson: string;
}>): string {
  return JSON.stringify({
    claimStatement: input.claimStatement,
    taskKey: input.taskKey,
    obligations: input.obligationDescriptions,
    expectedEvidenceTypes: input.expectedEvidenceTypes,
    retrieval: JSON.parse(input.retrievalJson),
    outputShape: {
      taskKey: "string",
      claimId: "uuid",
      candidates: [{
        id: "string",
        obligationKeys: ["string"],
        evidenceType: "string",
        observation: "string",
        excerpts: [{ path: "string", lineStart: 1, lineEnd: 1, normalizedSha256: "hex", excerptText: "string" }],
        strength: "weak|moderate|strong",
      }],
      gaps: [{ id: "string", obligationKeys: ["string"], description: "string", impact: "low|medium|high" }],
      counterevidence: [{ id: "string", description: "string", severity: "minor|material|critical" }],
    },
  });
}
