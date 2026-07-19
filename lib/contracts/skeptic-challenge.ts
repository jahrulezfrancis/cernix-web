import { z } from "zod";
import { InvestigationIdSchema } from "./investigation-api";

export const SKEPTIC_SCHEMA_VERSION = 1 as const;

export const SKEPTIC_CHALLENGES_MAX = 30;
export const SKEPTIC_KEY_MAX = 64;
export const SKEPTIC_TEXT_MAX = 4000;
export const SKEPTIC_TASK_KEYS_MAX = 20;

const bounded = (min: number, max: number) => z.string().trim().min(min).max(max);
const machineId = (max: number) => bounded(1, max).regex(/^[a-z][a-z0-9_]{0,63}$/);

export const ChallengeTypeSchema = z.enum([
  "unexamined_path", "bypass_or_exception", "test_mocks_behavior", "validation_db_mismatch",
  "demo_not_production", "narrower_scope", "missing_obligation", "counterevidence_unresolved", "other",
]);
export type ChallengeType = z.infer<typeof ChallengeTypeSchema>;

export const ChallengeSeveritySchema = z.enum(["critical", "major", "minor"]);
export type ChallengeSeverity = z.infer<typeof ChallengeSeveritySchema>;

export const ProvisionalVerdictHintSchema = z.enum(["supports", "weakly_supports", "insufficient", "contradicted"]);
export type ProvisionalVerdictHint = z.infer<typeof ProvisionalVerdictHintSchema>;

export const SkepticOutcomeSchema = z.enum(["cleared_for_judgment", "reinvestigation_required"]);
export type SkepticOutcome = z.infer<typeof SkepticOutcomeSchema>;

export const EvidenceReferenceSchema = z.strictObject({
  candidateKey: machineId(SKEPTIC_KEY_MAX),
  path: bounded(1, 512).optional(),
  lineStart: z.number().int().min(1).max(1_000_000).optional(),
  lineEnd: z.number().int().min(1).max(1_000_000).optional(),
  obligationKeys: z.array(machineId(SKEPTIC_KEY_MAX)).max(10).default([]),
}).superRefine((ref, context) => {
  if ((ref.lineStart === undefined) !== (ref.lineEnd === undefined)) {
    context.addIssue({ code: "custom", message: "Evidence reference line range must be complete." });
  }
  if (ref.lineStart !== undefined && ref.lineEnd !== undefined && ref.lineEnd < ref.lineStart) {
    context.addIssue({ code: "custom", message: "Invalid evidence reference line range." });
  }
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const SkepticChallengeSchema = z.strictObject({
  id: machineId(SKEPTIC_KEY_MAX),
  claimId: z.uuid(),
  challengeType: ChallengeTypeSchema,
  severity: ChallengeSeveritySchema,
  summary: bounded(1, 500),
  reasoning: bounded(1, SKEPTIC_TEXT_MAX),
  evidenceRefs: z.array(EvidenceReferenceSchema).max(10).default([]),
  relatedCandidateKeys: z.array(machineId(SKEPTIC_KEY_MAX)).max(10).default([]),
  requestedReinvestigation: z.boolean().default(false),
});
export type SkepticChallenge = z.infer<typeof SkepticChallengeSchema>;

export const ProvisionalClaimAnalysisSchema = z.strictObject({
  claimId: z.uuid(),
  provisionalVerdictHint: ProvisionalVerdictHintSchema,
  confidenceFactors: z.array(bounded(1, 500)).max(10).default([]),
  knownLimitations: z.array(bounded(1, 500)).max(10).default([]),
});
export type ProvisionalClaimAnalysis = z.infer<typeof ProvisionalClaimAnalysisSchema>;

export const SkepticArtifactSchema = z.strictObject({
  schemaVersion: z.literal(SKEPTIC_SCHEMA_VERSION),
  investigationId: InvestigationIdSchema,
  snapshotManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  claimAnalyses: z.array(ProvisionalClaimAnalysisSchema).min(1).max(10),
  challenges: z.array(SkepticChallengeSchema).max(SKEPTIC_CHALLENGES_MAX).default([]),
  outcome: SkepticOutcomeSchema,
  reinvestigationTaskKeys: z.array(machineId(SKEPTIC_KEY_MAX)).max(SKEPTIC_TASK_KEYS_MAX).default([]),
  skepticNotes: bounded(1, SKEPTIC_TEXT_MAX).optional(),
}).superRefine((artifact, context) => {
  if (artifact.outcome === "reinvestigation_required" && artifact.reinvestigationTaskKeys.length === 0) {
    context.addIssue({ code: "custom", message: "Reinvestigation requires task keys." });
  }
  if (artifact.outcome === "cleared_for_judgment" && artifact.reinvestigationTaskKeys.length > 0) {
    context.addIssue({ code: "custom", message: "Cleared outcome cannot request reinvestigation tasks." });
  }
});
export type SkepticArtifact = z.infer<typeof SkepticArtifactSchema>;

export function validateSkepticArtifact(raw: unknown): SkepticArtifact {
  return SkepticArtifactSchema.parse(raw);
}
