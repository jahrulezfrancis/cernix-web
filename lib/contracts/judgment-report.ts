import { createHash } from "node:crypto";
import { z } from "zod";
import { InvestigationIdSchema } from "./investigation-api";

export const JUDGE_SCHEMA_VERSION = 1 as const;
export const REPORT_SCHEMA_VERSION = 1 as const;

export const JUDGE_KEY_MAX = 64;
export const JUDGE_TEXT_MAX = 4000;
export const JUDGE_SUMMARY_MAX = 2000;
export const JUDGE_ITEMS_MAX = 30;

const bounded = (min: number, max: number) => z.string().trim().min(min).max(max);
const machineId = (max: number) => bounded(1, max).regex(/^[a-z][a-z0-9_]{0,63}$/);

export const UserVerdictSchema = z.enum(["verified", "partially_verified", "unverified"]);
export type UserVerdict = z.infer<typeof UserVerdictSchema>;

export const ConfidenceSchema = z.enum(["high", "moderate", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const CompletionDispositionSchema = z.enum(["completed", "completed_with_limitations"]);
export type CompletionDisposition = z.infer<typeof CompletionDispositionSchema>;

export const ClaimJudgmentSchema = z.strictObject({
  id: machineId(JUDGE_KEY_MAX),
  claimId: z.uuid(),
  verdict: UserVerdictSchema,
  confidence: ConfidenceSchema,
  summary: bounded(1, 500),
  reasoning: bounded(1, JUDGE_TEXT_MAX),
  confidenceFactors: z.array(bounded(1, 500)).max(10).default([]),
  unprovenAspects: z.array(bounded(1, 500)).max(10).default([]),
  whatCouldChangeVerdict: z.array(bounded(1, 500)).max(10).default([]),
});
export type ClaimJudgment = z.infer<typeof ClaimJudgmentSchema>;

export const ReportLimitationSchema = z.strictObject({
  id: machineId(JUDGE_KEY_MAX),
  claimId: z.uuid(),
  description: bounded(1, JUDGE_SUMMARY_MAX),
  impact: z.enum(["low", "medium", "high"]),
});
export type ReportLimitation = z.infer<typeof ReportLimitationSchema>;

export const MaintainerActionSchema = z.strictObject({
  id: machineId(JUDGE_KEY_MAX),
  claimId: z.uuid(),
  action: bounded(1, JUDGE_SUMMARY_MAX),
  priority: z.enum(["low", "medium", "high"]),
});
export type MaintainerAction = z.infer<typeof MaintainerActionSchema>;

export const JudgeArtifactSchema = z.strictObject({
  schemaVersion: z.literal(JUDGE_SCHEMA_VERSION),
  investigationId: InvestigationIdSchema,
  snapshotManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  claimJudgments: z.array(ClaimJudgmentSchema).min(1).max(10),
  limitations: z.array(ReportLimitationSchema).max(JUDGE_ITEMS_MAX).default([]),
  maintainerActions: z.array(MaintainerActionSchema).max(JUDGE_ITEMS_MAX).default([]),
  reportSummary: bounded(1, JUDGE_SUMMARY_MAX),
  completionDisposition: CompletionDispositionSchema,
}).superRefine((artifact, context) => {
  const claimIds = new Set(artifact.claimJudgments.map((judgment) => judgment.claimId));
  if (claimIds.size !== artifact.claimJudgments.length) {
    context.addIssue({ code: "custom", message: "Duplicate claim judgments are not allowed." });
  }
  for (const item of [...artifact.limitations, ...artifact.maintainerActions]) {
    if (!claimIds.has(item.claimId)) {
      context.addIssue({ code: "custom", message: "Report items must reference judged claims." });
    }
  }
  const needsLimitations = artifact.claimJudgments.some((judgment) => judgment.verdict !== "verified");
  if (needsLimitations && artifact.completionDisposition === "completed") {
    context.addIssue({ code: "custom", message: "Non-verified outcomes require completed_with_limitations." });
  }
});
export type JudgeArtifact = z.infer<typeof JudgeArtifactSchema>;

export function validateJudgeArtifact(raw: unknown): JudgeArtifact {
  return JudgeArtifactSchema.parse(raw);
}

export function deriveCompletionDisposition(artifact: Pick<JudgeArtifact, "claimJudgments">): CompletionDisposition {
  return artifact.claimJudgments.some((judgment) => judgment.verdict !== "verified")
    ? "completed_with_limitations" : "completed";
}

export function canonicalizeJudgeArtifact(artifact: JudgeArtifact): string {
  const ordered = {
    schemaVersion: artifact.schemaVersion,
    investigationId: artifact.investigationId,
    snapshotManifestHash: artifact.snapshotManifestHash,
    commitSha: artifact.commitSha,
    claimJudgments: [...artifact.claimJudgments].sort((left, right) => left.id.localeCompare(right.id)),
    limitations: [...artifact.limitations].sort((left, right) => left.id.localeCompare(right.id)),
    maintainerActions: [...artifact.maintainerActions].sort((left, right) => left.id.localeCompare(right.id)),
    reportSummary: artifact.reportSummary,
    completionDisposition: artifact.completionDisposition,
  };
  return `${JSON.stringify(ordered)}\n`;
}

export function hashJudgeArtifact(artifact: JudgeArtifact): string {
  return createHash("sha256").update(canonicalizeJudgeArtifact(artifact), "utf8").digest("hex");
}
