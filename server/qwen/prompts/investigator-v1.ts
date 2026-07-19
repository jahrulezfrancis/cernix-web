import { EvidenceTypeSchema } from "@/lib/contracts/investigation-plan";

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
  claimId: string;
  claimStatement: string;
  obligationKeys: readonly string[];
  obligationDescriptions: readonly string[];
  taskKey: string;
  expectedEvidenceTypes: readonly string[];
  retrievalJson: string;
}>): string {
  return JSON.stringify({
    claim: { id: input.claimId, statement: input.claimStatement },
    taskKey: input.taskKey,
    obligations: input.obligationKeys.map((key, index) => ({
      key,
      description: input.obligationDescriptions[index] ?? key,
    })),
    expectedEvidenceTypes: input.expectedEvidenceTypes,
    allowedEvidenceTypes: EvidenceTypeSchema.options,
    retrieval: JSON.parse(input.retrievalJson),
    outputShape: {
      taskKey: input.taskKey,
      claimId: input.claimId,
      candidates: [{
        id: "candidate_example",
        obligationKeys: input.obligationKeys.slice(0, 1),
        evidenceType: input.expectedEvidenceTypes[0] ?? "repository_structure",
        observation: "string",
        excerpts: [{ path: "path/from/retrieval", lineStart: 1, lineEnd: 1, normalizedSha256: "hex", excerptText: "string" }],
        strength: "moderate",
      }],
      gaps: [{ id: "gap_example", obligationKeys: input.obligationKeys.slice(0, 1), description: "string", impact: "medium" }],
      counterevidence: [{ id: "counter_example", description: "string", severity: "minor" }],
    },
  });
}
