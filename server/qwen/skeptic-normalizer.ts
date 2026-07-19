import {
  ChallengeSeveritySchema,
  ChallengeTypeSchema,
  ProvisionalVerdictHintSchema,
  SKEPTIC_SCHEMA_VERSION,
  SkepticOutcomeSchema,
  validateSkepticArtifact,
  type SkepticArtifact,
} from "@/lib/contracts/skeptic-challenge";
import { PlanningError } from "./errors";

const MACHINE_ID = /^[a-z][a-z0-9_]{0,63}$/;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningError("skeptic_schema_invalid");
  return value as Record<string, unknown>;
}

function normalizeMachineId(value: unknown, fallback: string): string {
  if (typeof value === "string" && MACHINE_ID.test(value.trim())) return value.trim();
  return fallback;
}

function normalizeEvidenceReference(raw: unknown): Record<string, unknown> | null {
  const ref = asRecord(raw);
  const candidateKey = normalizeMachineId(ref.candidateKey, "");
  if (!candidateKey) return null;
  const lineStart = typeof ref.lineStart === "number" ? ref.lineStart : undefined;
  const lineEnd = typeof ref.lineEnd === "number" ? ref.lineEnd : undefined;
  const obligationKeys = Array.isArray(ref.obligationKeys)
    ? ref.obligationKeys.flatMap((key) => {
        if (typeof key !== "string" || !MACHINE_ID.test(key.trim())) return [];
        return [key.trim()];
      })
    : [];
  return {
    candidateKey,
    ...(typeof ref.path === "string" && ref.path.trim() ? { path: ref.path.trim() } : {}),
    ...(lineStart !== undefined && lineEnd !== undefined && lineEnd >= lineStart ? { lineStart, lineEnd } : {}),
    obligationKeys,
  };
}

function normalizeChallenge(raw: unknown, claimId: string, index: number): Record<string, unknown> {
  const challenge = asRecord(raw);
  const challengeType = ChallengeTypeSchema.safeParse(challenge.challengeType);
  const severity = ChallengeSeveritySchema.safeParse(challenge.severity);
  const evidenceRefs = Array.isArray(challenge.evidenceRefs)
    ? challenge.evidenceRefs.flatMap((ref) => {
        try {
          const normalized = normalizeEvidenceReference(ref);
          return normalized ? [normalized] : [];
        } catch {
          return [];
        }
      })
    : [];
  const relatedCandidateKeys = Array.isArray(challenge.relatedCandidateKeys)
    ? challenge.relatedCandidateKeys.flatMap((key) => {
        if (typeof key !== "string" || !MACHINE_ID.test(key.trim())) return [];
        return [key.trim()];
      })
    : [];
  return {
    id: normalizeMachineId(challenge.id, `challenge_${index + 1}`),
    claimId,
    challengeType: challengeType.success ? challengeType.data : "other",
    severity: severity.success ? severity.data : "major",
    summary: typeof challenge.summary === "string" && challenge.summary.trim() ? challenge.summary.trim() : "Challenge identified.",
    reasoning: typeof challenge.reasoning === "string" && challenge.reasoning.trim() ? challenge.reasoning.trim() : "Further review required.",
    evidenceRefs,
    relatedCandidateKeys,
    requestedReinvestigation: challenge.requestedReinvestigation === true,
  };
}

function normalizeClaimAnalysis(raw: unknown, claimId: string): Record<string, unknown> {
  const analysis = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const provisionalVerdictHint = ProvisionalVerdictHintSchema.safeParse(analysis.provisionalVerdictHint);
  const confidenceFactors = Array.isArray(analysis.confidenceFactors)
    ? analysis.confidenceFactors.flatMap((factor) => typeof factor === "string" && factor.trim() ? [factor.trim()] : [])
    : [];
  const knownLimitations = Array.isArray(analysis.knownLimitations)
    ? analysis.knownLimitations.flatMap((limitation) => typeof limitation === "string" && limitation.trim() ? [limitation.trim()] : [])
    : [];
  return {
    claimId,
    provisionalVerdictHint: provisionalVerdictHint.success ? provisionalVerdictHint.data : "insufficient",
    confidenceFactors,
    knownLimitations,
  };
}

export function buildSkepticArtifactFromProviderResponse(params: Readonly<{
  parsed: unknown;
  investigationId: string;
  claimId: string;
  snapshotManifestHash: string;
  commitSha: string;
}>): SkepticArtifact {
  const parsed = params.parsed && typeof params.parsed === "object" && !Array.isArray(params.parsed)
    ? params.parsed as Record<string, unknown>
    : {};
  const rawClaimAnalyses = Array.isArray(parsed.claimAnalyses) ? parsed.claimAnalyses : [];
  const claimAnalyses = rawClaimAnalyses.length > 0
    ? rawClaimAnalyses.map((analysis) => normalizeClaimAnalysis(analysis, params.claimId))
    : [normalizeClaimAnalysis({}, params.claimId)];
  const challenges = Array.isArray(parsed.challenges)
    ? parsed.challenges.map((challenge, index) => normalizeChallenge(challenge, params.claimId, index))
    : [];
  const reinvestigationTaskKeys = Array.isArray(parsed.reinvestigationTaskKeys)
    ? parsed.reinvestigationTaskKeys.flatMap((key, index) => [normalizeMachineId(key, `task_${index + 1}`)])
        .filter((key, index, keys) => keys.indexOf(key) === index)
    : [];
  let outcome = SkepticOutcomeSchema.safeParse(parsed.outcome);
  let resolvedOutcome = outcome.success ? outcome.data : "cleared_for_judgment";
  if (reinvestigationTaskKeys.length > 0) resolvedOutcome = "reinvestigation_required";
  if (resolvedOutcome === "reinvestigation_required" && reinvestigationTaskKeys.length === 0) {
    resolvedOutcome = "cleared_for_judgment";
  }
  const rawArtifact = {
    schemaVersion: SKEPTIC_SCHEMA_VERSION,
    investigationId: params.investigationId,
    snapshotManifestHash: params.snapshotManifestHash,
    commitSha: params.commitSha,
    claimAnalyses,
    challenges,
    outcome: resolvedOutcome,
    reinvestigationTaskKeys: resolvedOutcome === "reinvestigation_required" ? reinvestigationTaskKeys : [],
    ...(typeof parsed.skepticNotes === "string" && parsed.skepticNotes.trim() ? { skepticNotes: parsed.skepticNotes.trim() } : {}),
  };
  try {
    return validateSkepticArtifact(rawArtifact);
  } catch (error) {
    throw new PlanningError("skeptic_schema_invalid", error);
  }
}
