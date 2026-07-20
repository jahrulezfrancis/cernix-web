import {
  validateSkepticArtifact,
  type EvidenceReference,
  type SkepticArtifact,
} from "@/lib/contracts/skeptic-challenge";
import { ApplicationError } from "@/server/errors";

export type PersistedEvidenceIndex = Readonly<{
  candidateKeys: ReadonlySet<string>;
  excerptsByCandidate: ReadonlyMap<string, ReadonlySet<string>>;
}>;

export type SkepticTaskRunRef = Readonly<{
  task_key: string;
  specialist_capability: string;
}>;

export function buildEvidenceIndex(rows: readonly Readonly<{
  candidate_key: string;
  path: string | null;
  line_start: number | null;
  line_end: number | null;
}>[]): PersistedEvidenceIndex {
  const candidateKeys = new Set<string>();
  const excerptsByCandidate = new Map<string, Set<string>>();
  for (const row of rows) {
    candidateKeys.add(row.candidate_key);
    if (row.path && row.line_start && row.line_end) {
      const key = `${row.path}:${row.line_start}:${row.line_end}`;
      const set = excerptsByCandidate.get(row.candidate_key) ?? new Set<string>();
      set.add(key);
      excerptsByCandidate.set(row.candidate_key, set);
    }
  }
  return { candidateKeys, excerptsByCandidate };
}

/** Build provenance indexes from the skeptic context evidence summary shape. */
export function buildProvenanceFromEvidenceSummary(evidenceSummary: unknown): Readonly<{
  index: PersistedEvidenceIndex;
  taskRuns: readonly SkepticTaskRunRef[];
}> {
  const summary = evidenceSummary && typeof evidenceSummary === "object" && !Array.isArray(evidenceSummary)
    ? evidenceSummary as Record<string, unknown>
    : {};
  const tasks = Array.isArray(summary.tasks) ? summary.tasks : [];
  const rows: Array<{
    candidate_key: string;
    path: string | null;
    line_start: number | null;
    line_end: number | null;
  }> = [];
  const taskRuns: SkepticTaskRunRef[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task)) continue;
    const record = task as Record<string, unknown>;
    if (typeof record.taskKey === "string" && typeof record.specialistCapability === "string") {
      taskRuns.push({ task_key: record.taskKey, specialist_capability: record.specialistCapability });
    }
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const cand = candidate as Record<string, unknown>;
      if (typeof cand.candidateKey !== "string") continue;
      const excerpts = Array.isArray(cand.excerpts) ? cand.excerpts : [];
      if (excerpts.length === 0) {
        rows.push({ candidate_key: cand.candidateKey, path: null, line_start: null, line_end: null });
        continue;
      }
      for (const excerpt of excerpts) {
        if (!excerpt || typeof excerpt !== "object" || Array.isArray(excerpt)) {
          rows.push({ candidate_key: cand.candidateKey, path: null, line_start: null, line_end: null });
          continue;
        }
        const ex = excerpt as Record<string, unknown>;
        rows.push({
          candidate_key: cand.candidateKey,
          path: typeof ex.path === "string" ? ex.path : null,
          line_start: typeof ex.lineStart === "number" ? ex.lineStart : null,
          line_end: typeof ex.lineEnd === "number" ? ex.lineEnd : null,
        });
      }
    }
  }
  return { index: buildEvidenceIndex(rows), taskRuns };
}

function sanitizeEvidenceRef(ref: EvidenceReference, index: PersistedEvidenceIndex): EvidenceReference | null {
  if (!index.candidateKeys.has(ref.candidateKey)) return null;
  if (ref.path && ref.lineStart !== undefined && ref.lineEnd !== undefined) {
    const excerptKey = `${ref.path}:${ref.lineStart}:${ref.lineEnd}`;
    const excerpts = index.excerptsByCandidate.get(ref.candidateKey);
    if (!excerpts?.has(excerptKey)) {
      return { candidateKey: ref.candidateKey, obligationKeys: ref.obligationKeys };
    }
  }
  return ref;
}

/**
 * Drop invented / ungrounded evidence refs and reinvestigation task keys so model
 * drift cannot fail the whole investigation as skeptic_schema_invalid.
 */
export function sanitizeSkepticArtifactForProvenance(
  artifact: SkepticArtifact,
  index: PersistedEvidenceIndex,
  runs: readonly SkepticTaskRunRef[],
): SkepticArtifact {
  const allowedTasks = new Set(
    runs
      .filter((run) => run.specialist_capability === "repository_investigator")
      .map((run) => run.task_key),
  );
  const challenges = artifact.challenges.map((challenge) => ({
    ...challenge,
    evidenceRefs: challenge.evidenceRefs.flatMap((ref) => {
      const sanitized = sanitizeEvidenceRef(ref, index);
      return sanitized ? [sanitized] : [];
    }),
    relatedCandidateKeys: challenge.relatedCandidateKeys.filter((key) => index.candidateKeys.has(key)),
  }));
  const reinvestigationTaskKeys = artifact.reinvestigationTaskKeys.filter((key) => allowedTasks.has(key));
  const outcome = reinvestigationTaskKeys.length > 0 ? "reinvestigation_required" : "cleared_for_judgment";
  return validateSkepticArtifact({
    ...artifact,
    challenges,
    outcome,
    reinvestigationTaskKeys,
  });
}

export function validateChallengeEvidenceRefs(artifact: SkepticArtifact, index: PersistedEvidenceIndex): void {
  for (const challenge of artifact.challenges) {
    for (const ref of challenge.evidenceRefs) {
      if (!index.candidateKeys.has(ref.candidateKey)) throw new ApplicationError("malformed_input", {});
      if (ref.path && ref.lineStart && ref.lineEnd) {
        const excerptKey = `${ref.path}:${ref.lineStart}:${ref.lineEnd}`;
        const excerpts = index.excerptsByCandidate.get(ref.candidateKey);
        if (!excerpts?.has(excerptKey)) throw new ApplicationError("malformed_input", {});
      }
    }
    for (const key of challenge.relatedCandidateKeys) {
      if (!index.candidateKeys.has(key)) throw new ApplicationError("malformed_input", {});
    }
  }
}

export function validateReinvestigationTaskKeys(artifact: SkepticArtifact, runs: readonly SkepticTaskRunRef[]): void {
  if (artifact.outcome !== "reinvestigation_required") {
    if (artifact.reinvestigationTaskKeys.length > 0) throw new ApplicationError("malformed_input", {});
    return;
  }
  const byKey = new Map(runs.map((run) => [run.task_key, run]));
  const unique = new Set(artifact.reinvestigationTaskKeys);
  if (unique.size !== artifact.reinvestigationTaskKeys.length) throw new ApplicationError("malformed_input", {});
  for (const taskKey of artifact.reinvestigationTaskKeys) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(taskKey)) throw new ApplicationError("malformed_input", {});
    const run = byKey.get(taskKey);
    if (!run || run.specialist_capability !== "repository_investigator") throw new ApplicationError("malformed_input", {});
  }
}
