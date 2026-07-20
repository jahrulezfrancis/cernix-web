import {
  ChallengeSeveritySchema,
  ChallengeTypeSchema,
  ProvisionalVerdictHintSchema,
  SKEPTIC_CHALLENGES_MAX,
  SKEPTIC_SCHEMA_VERSION,
  SKEPTIC_TASK_KEYS_MAX,
  SKEPTIC_TEXT_MAX,
  SkepticOutcomeSchema,
  validateSkepticArtifact,
  type SkepticArtifact,
} from "@/lib/contracts/skeptic-challenge";
import { PlanningError } from "./errors";

const MACHINE_ID = /^[a-z][a-z0-9_]{0,63}$/;
const SUMMARY_MAX = 500;
const FACTOR_MAX = 500;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningError("skeptic_schema_invalid");
  return value as Record<string, unknown>;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function normalizeMachineId(value: unknown, fallback: string): string {
  if (typeof value === "string" && MACHINE_ID.test(value.trim())) return value.trim();
  return fallback;
}

function normalizeOptionalMachineId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return MACHINE_ID.test(trimmed) ? trimmed : null;
}

function normalizeEvidenceReference(raw: unknown): Record<string, unknown> | null {
  const ref = asRecord(raw);
  const candidateKey = normalizeOptionalMachineId(ref.candidateKey);
  if (!candidateKey) return null;
  const lineStart = typeof ref.lineStart === "number" ? ref.lineStart : undefined;
  const lineEnd = typeof ref.lineEnd === "number" ? ref.lineEnd : undefined;
  const obligationKeys = Array.isArray(ref.obligationKeys)
    ? ref.obligationKeys.flatMap((key) => {
        const normalized = normalizeOptionalMachineId(key);
        return normalized ? [normalized] : [];
      }).slice(0, 10)
    : [];
  const path = typeof ref.path === "string" && ref.path.trim()
    ? truncate(ref.path.trim(), 512)
    : undefined;
  return {
    candidateKey,
    ...(path ? { path } : {}),
    ...(lineStart !== undefined && lineEnd !== undefined && lineEnd >= lineStart ? { lineStart, lineEnd } : {}),
    obligationKeys,
  };
}

function normalizeChallenge(raw: unknown, claimId: string, index: number, usedIds: Set<string>): Record<string, unknown> {
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
      }).slice(0, 10)
    : [];
  const relatedCandidateKeys = Array.isArray(challenge.relatedCandidateKeys)
    ? challenge.relatedCandidateKeys.flatMap((key) => {
        const normalized = normalizeOptionalMachineId(key);
        return normalized ? [normalized] : [];
      }).filter((key, i, keys) => keys.indexOf(key) === i).slice(0, 10)
    : [];
  let id = normalizeMachineId(challenge.id, `challenge_${index + 1}`);
  if (usedIds.has(id)) id = `challenge_${index + 1}`;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = truncate(`challenge_${index + 1}_${suffix}`, 64);
    suffix += 1;
  }
  usedIds.add(id);
  const summaryRaw = typeof challenge.summary === "string" && challenge.summary.trim()
    ? challenge.summary.trim()
    : "Challenge identified.";
  const reasoningRaw = typeof challenge.reasoning === "string" && challenge.reasoning.trim()
    ? challenge.reasoning.trim()
    : "Further review required.";
  return {
    id,
    claimId,
    challengeType: challengeType.success ? challengeType.data : "other",
    severity: severity.success ? severity.data : "major",
    summary: truncate(summaryRaw, SUMMARY_MAX),
    reasoning: truncate(reasoningRaw, SKEPTIC_TEXT_MAX),
    evidenceRefs,
    relatedCandidateKeys,
    requestedReinvestigation: challenge.requestedReinvestigation === true,
  };
}

function normalizeClaimAnalysis(raw: unknown, claimId: string): Record<string, unknown> {
  const analysis = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const provisionalVerdictHint = ProvisionalVerdictHintSchema.safeParse(analysis.provisionalVerdictHint);
  const confidenceFactors = Array.isArray(analysis.confidenceFactors)
    ? analysis.confidenceFactors.flatMap((factor) => {
        if (typeof factor !== "string" || !factor.trim()) return [];
        return [truncate(factor.trim(), FACTOR_MAX)];
      }).slice(0, 10)
    : [];
  const knownLimitations = Array.isArray(analysis.knownLimitations)
    ? analysis.knownLimitations.flatMap((limitation) => {
        if (typeof limitation !== "string" || !limitation.trim()) return [];
        return [truncate(limitation.trim(), FACTOR_MAX)];
      }).slice(0, 10)
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
  const claimAnalyses = (rawClaimAnalyses.length > 0
    ? rawClaimAnalyses.map((analysis) => normalizeClaimAnalysis(analysis, params.claimId))
    : [normalizeClaimAnalysis({}, params.claimId)]).slice(0, 10);
  const usedIds = new Set<string>();
  const challenges = Array.isArray(parsed.challenges)
    ? parsed.challenges
        .flatMap((challenge, index) => {
          try {
            return [normalizeChallenge(challenge, params.claimId, index, usedIds)];
          } catch {
            return [];
          }
        })
        .slice(0, SKEPTIC_CHALLENGES_MAX)
    : [];
  // Drop invalid keys — never invent task_N fallbacks that fail provenance.
  const reinvestigationTaskKeys = Array.isArray(parsed.reinvestigationTaskKeys)
    ? parsed.reinvestigationTaskKeys.flatMap((key) => {
        const normalized = normalizeOptionalMachineId(key);
        return normalized ? [normalized] : [];
      }).filter((key, index, keys) => keys.indexOf(key) === index).slice(0, SKEPTIC_TASK_KEYS_MAX)
    : [];
  const outcome = SkepticOutcomeSchema.safeParse(parsed.outcome);
  let resolvedOutcome = outcome.success ? outcome.data : "cleared_for_judgment";
  if (reinvestigationTaskKeys.length > 0) resolvedOutcome = "reinvestigation_required";
  if (resolvedOutcome === "reinvestigation_required" && reinvestigationTaskKeys.length === 0) {
    resolvedOutcome = "cleared_for_judgment";
  }
  const skepticNotes = typeof parsed.skepticNotes === "string" && parsed.skepticNotes.trim()
    ? truncate(parsed.skepticNotes.trim(), SKEPTIC_TEXT_MAX)
    : undefined;
  const rawArtifact = {
    schemaVersion: SKEPTIC_SCHEMA_VERSION,
    investigationId: params.investigationId,
    snapshotManifestHash: params.snapshotManifestHash,
    commitSha: params.commitSha,
    claimAnalyses,
    challenges,
    outcome: resolvedOutcome,
    reinvestigationTaskKeys: resolvedOutcome === "reinvestigation_required" ? reinvestigationTaskKeys : [],
    ...(skepticNotes ? { skepticNotes } : {}),
  };
  try {
    return validateSkepticArtifact(rawArtifact);
  } catch (error) {
    throw new PlanningError("skeptic_schema_invalid", error);
  }
}
