import {
  ConfidenceSchema,
  CompletionDispositionSchema,
  deriveCompletionDisposition,
  JUDGE_SCHEMA_VERSION,
  UserVerdictSchema,
  validateJudgeArtifact,
  type JudgeArtifact,
} from "@/lib/contracts/judgment-report";
import { PlanningError } from "./errors";

const MACHINE_ID = /^[a-z][a-z0-9_]{0,63}$/;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningError("judge_schema_invalid");
  return value as Record<string, unknown>;
}

function normalizeMachineId(value: unknown, fallback: string): string {
  if (typeof value === "string" && MACHINE_ID.test(value.trim())) return value.trim();
  return fallback;
}

function normalizeStringArray(values: unknown): string[] {
  return Array.isArray(values)
    ? values.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : [])
    : [];
}

function normalizeClaimJudgment(raw: unknown, claimId: string, index: number): Record<string, unknown> {
  const judgment = asRecord(raw);
  const verdict = UserVerdictSchema.safeParse(judgment.verdict);
  const confidence = ConfidenceSchema.safeParse(judgment.confidence);
  return {
    id: normalizeMachineId(judgment.id, `judgment_${index + 1}`),
    claimId,
    verdict: verdict.success ? verdict.data : "unverified",
    confidence: confidence.success ? confidence.data : "low",
    summary: typeof judgment.summary === "string" && judgment.summary.trim() ? judgment.summary.trim() : "Judgment summary unavailable.",
    reasoning: typeof judgment.reasoning === "string" && judgment.reasoning.trim() ? judgment.reasoning.trim() : "Judgment reasoning unavailable.",
    confidenceFactors: normalizeStringArray(judgment.confidenceFactors),
    unprovenAspects: normalizeStringArray(judgment.unprovenAspects),
    whatCouldChangeVerdict: normalizeStringArray(judgment.whatCouldChangeVerdict),
  };
}

function normalizeLimitation(raw: unknown, claimId: string, index: number): Record<string, unknown> {
  const limitation = asRecord(raw);
  const impact = limitation.impact === "low" || limitation.impact === "medium" || limitation.impact === "high"
    ? limitation.impact
    : "medium";
  return {
    id: normalizeMachineId(limitation.id, `limitation_${index + 1}`),
    claimId,
    description: typeof limitation.description === "string" && limitation.description.trim()
      ? limitation.description.trim()
      : "Investigation limitation.",
    impact,
  };
}

function normalizeMaintainerAction(raw: unknown, claimId: string, index: number): Record<string, unknown> {
  const action = asRecord(raw);
  const priority = action.priority === "low" || action.priority === "medium" || action.priority === "high"
    ? action.priority
    : "medium";
  return {
    id: normalizeMachineId(action.id, `action_${index + 1}`),
    claimId,
    action: typeof action.action === "string" && action.action.trim() ? action.action.trim() : "Review recommended follow-up.",
    priority,
  };
}

export function buildJudgeArtifactFromProviderResponse(params: Readonly<{
  parsed: unknown;
  investigationId: string;
  claimId: string;
  snapshotManifestHash: string;
  commitSha: string;
}>): JudgeArtifact {
  const parsed = params.parsed && typeof params.parsed === "object" && !Array.isArray(params.parsed)
    ? params.parsed as Record<string, unknown>
    : {};
  const rawClaimJudgments = Array.isArray(parsed.claimJudgments) ? parsed.claimJudgments : [];
  const claimJudgments = rawClaimJudgments.length > 0
    ? rawClaimJudgments.map((judgment, index) => normalizeClaimJudgment(judgment, params.claimId, index))
    : [normalizeClaimJudgment({}, params.claimId, 0)];
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations.map((limitation, index) => normalizeLimitation(limitation, params.claimId, index))
    : [];
  const maintainerActions = Array.isArray(parsed.maintainerActions)
    ? parsed.maintainerActions.map((action, index) => normalizeMaintainerAction(action, params.claimId, index))
    : [];
  const reportSummary = typeof parsed.reportSummary === "string" && parsed.reportSummary.trim()
    ? parsed.reportSummary.trim()
    : "Investigation completed.";
  const completionDisposition = deriveCompletionDisposition({ claimJudgments: claimJudgments as never });
  const parsedDisposition = CompletionDispositionSchema.safeParse(parsed.completionDisposition);
  const resolvedDisposition = parsedDisposition.success && (
    completionDisposition === "completed_with_limitations" || parsedDisposition.data === "completed"
  ) ? parsedDisposition.data : completionDisposition;
  const rawArtifact = {
    schemaVersion: JUDGE_SCHEMA_VERSION,
    investigationId: params.investigationId,
    snapshotManifestHash: params.snapshotManifestHash,
    commitSha: params.commitSha,
    claimJudgments,
    limitations,
    maintainerActions,
    reportSummary,
    completionDisposition: resolvedDisposition,
  };
  try {
    return validateJudgeArtifact(rawArtifact);
  } catch (error) {
    throw new PlanningError("judge_schema_invalid", error);
  }
}
