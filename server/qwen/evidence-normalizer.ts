import {
  CounterSeveritySchema,
  EvidenceStrengthSchema,
  GapImpactSchema,
  validateEvidenceTaskResult,
  type EvidenceTaskResult,
} from "@/lib/contracts/evidence-candidate";
import { EvidenceTypeSchema } from "@/lib/contracts/investigation-plan";
import { PlanningError } from "./errors";

const MACHINE_ID = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type EvidenceRetrievalMatch = Readonly<{
  path: string;
  lineStart: number;
  lineEnd: number;
  normalizedSha256: string;
  excerptText: string;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanningError("evidence_schema_invalid");
  return value as Record<string, unknown>;
}

function normalizeMachineId(value: unknown, fallback: string): string {
  if (typeof value === "string" && MACHINE_ID.test(value.trim())) return value.trim();
  return fallback;
}

function normalizeObligationKeys(raw: unknown, allowedKeys: readonly string[]): string[] {
  const keys = Array.isArray(raw)
    ? raw.flatMap((value) => {
        if (typeof value !== "string" || !MACHINE_ID.test(value.trim())) return [];
        return allowedKeys.includes(value.trim()) ? [value.trim()] : [];
      })
    : [];
  if (keys.length > 0) return keys;
  return allowedKeys.length > 0 ? [allowedKeys[0]!] : [];
}

function normalizeExcerpt(raw: unknown, matches: readonly EvidenceRetrievalMatch[]): Record<string, unknown> | null {
  const excerpt = asRecord(raw);
  const path = typeof excerpt.path === "string" ? excerpt.path.trim() : "";
  if (!path) return null;
  const match = matches.find((item) => item.path === path)
    ?? matches.find((item) => item.path.endsWith(path) || path.endsWith(item.path));
  if (match) {
    return {
      path: match.path,
      lineStart: match.lineStart,
      lineEnd: match.lineEnd,
      normalizedSha256: match.normalizedSha256,
      excerptText: match.excerptText,
    };
  }
  const lineStart = typeof excerpt.lineStart === "number" ? excerpt.lineStart : undefined;
  const lineEnd = typeof excerpt.lineEnd === "number" ? excerpt.lineEnd : undefined;
  const normalizedSha256 = typeof excerpt.normalizedSha256 === "string" && SHA256.test(excerpt.normalizedSha256)
    ? excerpt.normalizedSha256
    : null;
  const excerptText = typeof excerpt.excerptText === "string" && excerpt.excerptText.trim() ? excerpt.excerptText.trim() : null;
  if (!normalizedSha256 || !excerptText || lineStart === undefined || lineEnd === undefined || lineEnd < lineStart) return null;
  return { path, lineStart, lineEnd, normalizedSha256, excerptText };
}

function normalizeCandidate(raw: unknown, allowedKeys: readonly string[], matches: readonly EvidenceRetrievalMatch[], index: number): Record<string, unknown> | null {
  const candidate = asRecord(raw);
  const excerpts = Array.isArray(candidate.excerpts)
    ? candidate.excerpts.flatMap((excerpt) => {
        try {
          const normalized = normalizeExcerpt(excerpt, matches);
          return normalized ? [normalized] : [];
        } catch {
          return [];
        }
      })
    : [];
  if (excerpts.length < 1) return null;
  const evidenceType = EvidenceTypeSchema.safeParse(candidate.evidenceType);
  const strength = EvidenceStrengthSchema.safeParse(candidate.strength);
  const observation = typeof candidate.observation === "string" && candidate.observation.trim()
    ? candidate.observation.trim()
    : "Evidence observation recorded from repository excerpts.";
  return {
    id: normalizeMachineId(candidate.id, `candidate_${index + 1}`),
    obligationKeys: normalizeObligationKeys(candidate.obligationKeys, allowedKeys),
    evidenceType: evidenceType.success ? evidenceType.data : "repository_structure",
    observation,
    excerpts,
    strength: strength.success ? strength.data : "moderate",
  };
}

function normalizeGap(raw: unknown, allowedKeys: readonly string[], index: number): Record<string, unknown> | null {
  const gap = asRecord(raw);
  const impact = GapImpactSchema.safeParse(gap.impact);
  const description = typeof gap.description === "string" && gap.description.trim() ? gap.description.trim() : null;
  if (!description) return null;
  return {
    id: normalizeMachineId(gap.id, `gap_${index + 1}`),
    obligationKeys: normalizeObligationKeys(gap.obligationKeys, allowedKeys),
    description,
    impact: impact.success ? impact.data : "medium",
  };
}

function normalizeCounterevidence(raw: unknown, index: number): Record<string, unknown> | null {
  const counter = asRecord(raw);
  const severity = CounterSeveritySchema.safeParse(counter.severity);
  const description = typeof counter.description === "string" && counter.description.trim() ? counter.description.trim() : null;
  if (!description) return null;
  const relatedCandidateId = typeof counter.relatedCandidateId === "string" && MACHINE_ID.test(counter.relatedCandidateId.trim())
    ? counter.relatedCandidateId.trim()
    : undefined;
  return {
    id: normalizeMachineId(counter.id, `counter_${index + 1}`),
    description,
    severity: severity.success ? severity.data : "minor",
    ...(relatedCandidateId ? { relatedCandidateId } : {}),
  };
}

export function buildEvidenceTaskResultFromProviderResponse(params: Readonly<{
  parsed: unknown;
  taskKey: string;
  claimId: string;
  obligationKeys: readonly string[];
  retrievalMatches: readonly EvidenceRetrievalMatch[];
}>): EvidenceTaskResult {
  const parsed = params.parsed && typeof params.parsed === "object" && !Array.isArray(params.parsed)
    ? params.parsed as Record<string, unknown>
    : {};
  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates.flatMap((candidate, index) => {
        try {
          const normalized = normalizeCandidate(candidate, params.obligationKeys, params.retrievalMatches, index);
          return normalized ? [normalized] : [];
        } catch {
          return [];
        }
      })
    : [];
  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps.flatMap((gap, index) => {
        try {
          const normalized = normalizeGap(gap, params.obligationKeys, index);
          return normalized ? [normalized] : [];
        } catch {
          return [];
        }
      })
    : [];
  const counterevidence = Array.isArray(parsed.counterevidence)
    ? parsed.counterevidence.flatMap((counter, index) => {
        try {
          const normalized = normalizeCounterevidence(counter, index);
          return normalized ? [normalized] : [];
        } catch {
          return [];
        }
      })
    : [];
  const rawResult = {
    taskKey: params.taskKey,
    claimId: params.claimId,
    candidates,
    gaps,
    counterevidence,
    ...(typeof parsed.investigatorNotes === "string" && parsed.investigatorNotes.trim()
      ? { investigatorNotes: parsed.investigatorNotes.trim() }
      : {}),
  };
  try {
    return validateEvidenceTaskResult(rawResult);
  } catch (error) {
    throw new PlanningError("evidence_schema_invalid", error);
  }
}
