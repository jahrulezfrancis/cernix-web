import { z } from "zod";
import { InvestigationIdSchema } from "./investigation-api";
import { EvidenceTypeSchema } from "./investigation-plan";

export const EVIDENCE_SCHEMA_VERSION = 1 as const;

export const EVIDENCE_OBSERVATION_MAX = 4000;
export const EVIDENCE_EXCERPT_MAX = 8000;
export const EVIDENCE_CANDIDATES_MAX = 30;
export const EVIDENCE_EXCERPTS_MAX = 20;
export const EVIDENCE_GAPS_MAX = 20;
export const EVIDENCE_COUNTER_MAX = 20;
export const EVIDENCE_KEY_MAX = 64;

const bounded = (min: number, max: number) => z.string().trim().min(min).max(max);
const machineId = (max: number) => bounded(1, max).regex(/^[a-z][a-z0-9_]{0,63}$/);

export const EvidenceStrengthSchema = z.enum(["weak", "moderate", "strong"]);
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>;

export const GapImpactSchema = z.enum(["low", "medium", "high"]);
export type GapImpact = z.infer<typeof GapImpactSchema>;

export const CounterSeveritySchema = z.enum(["minor", "material", "critical"]);
export type CounterSeverity = z.infer<typeof CounterSeveritySchema>;

export const EvidenceExcerptSchema = z.strictObject({
  path: bounded(1, 512),
  lineStart: z.number().int().min(1).max(1_000_000),
  lineEnd: z.number().int().min(1).max(1_000_000),
  normalizedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  excerptText: bounded(1, EVIDENCE_EXCERPT_MAX),
}).superRefine((excerpt, context) => {
  if (excerpt.lineEnd < excerpt.lineStart) {
    context.addIssue({ code: "custom", message: "Invalid excerpt line range." });
  }
});
export type EvidenceExcerpt = z.infer<typeof EvidenceExcerptSchema>;

export const EvidenceCandidateSchema = z.strictObject({
  id: machineId(EVIDENCE_KEY_MAX),
  obligationKeys: z.array(machineId(EVIDENCE_KEY_MAX)).min(1).max(10),
  evidenceType: EvidenceTypeSchema,
  observation: bounded(1, EVIDENCE_OBSERVATION_MAX),
  excerpts: z.array(EvidenceExcerptSchema).min(1).max(EVIDENCE_EXCERPTS_MAX),
  strength: EvidenceStrengthSchema,
});
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;

export const EvidenceGapSchema = z.strictObject({
  id: machineId(EVIDENCE_KEY_MAX),
  obligationKeys: z.array(machineId(EVIDENCE_KEY_MAX)).min(1).max(10),
  description: bounded(1, 2000),
  impact: GapImpactSchema,
});
export type EvidenceGap = z.infer<typeof EvidenceGapSchema>;

export const CounterevidenceSchema = z.strictObject({
  id: machineId(EVIDENCE_KEY_MAX),
  relatedCandidateId: machineId(EVIDENCE_KEY_MAX).optional(),
  description: bounded(1, 2000),
  severity: CounterSeveritySchema,
});
export type Counterevidence = z.infer<typeof CounterevidenceSchema>;

export const EvidenceTaskResultSchema = z.strictObject({
  taskKey: machineId(EVIDENCE_KEY_MAX),
  claimId: z.uuid(),
  candidates: z.array(EvidenceCandidateSchema).max(EVIDENCE_CANDIDATES_MAX).default([]),
  gaps: z.array(EvidenceGapSchema).max(EVIDENCE_GAPS_MAX).default([]),
  counterevidence: z.array(CounterevidenceSchema).max(EVIDENCE_COUNTER_MAX).default([]),
  investigatorNotes: bounded(1, 4000).optional(),
});
export type EvidenceTaskResult = z.infer<typeof EvidenceTaskResultSchema>;

export const InvestigationEvidenceArtifactSchema = z.strictObject({
  schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
  investigationId: InvestigationIdSchema,
  snapshotManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  taskResults: z.array(EvidenceTaskResultSchema).min(1).max(150),
});
export type InvestigationEvidenceArtifact = z.infer<typeof InvestigationEvidenceArtifactSchema>;

export function validateEvidenceTaskResult(raw: unknown): EvidenceTaskResult {
  return EvidenceTaskResultSchema.parse(raw);
}
