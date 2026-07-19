import { z } from "zod";

export const InvestigationEvidenceBundleSchema = z
  .object({
    tasks: z.array(
      z.object({
        taskKey: z.string(),
        status: z.string(),
        specialistCapability: z.string(),
        claimId: z.uuid(),
        candidates: z.array(
          z.object({
            candidateKey: z.string(),
            evidenceType: z.string(),
            strength: z.string(),
            observation: z.string(),
            commitSha: z.string(),
            excerpts: z.array(
              z.object({
                path: z.string(),
                lineStart: z.number().int(),
                lineEnd: z.number().int(),
                excerptText: z.string(),
              }),
            ),
          }),
        ),
        gaps: z.array(
          z.object({
            id: z.string(),
            description: z.string(),
            impact: z.string(),
          }),
        ),
        counterevidence: z.array(
          z.object({
            id: z.string(),
            description: z.string(),
            severity: z.string(),
            relatedCandidateId: z.string().nullable(),
          }),
        ),
      }),
    ),
  })
  .strict();

export type InvestigationEvidenceBundle = z.infer<typeof InvestigationEvidenceBundleSchema>;
