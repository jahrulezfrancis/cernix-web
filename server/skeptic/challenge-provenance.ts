import type { SkepticArtifact } from "@/lib/contracts/skeptic-challenge";
import { ApplicationError } from "@/server/errors";

export type PersistedEvidenceIndex = Readonly<{
  candidateKeys: ReadonlySet<string>;
  excerptsByCandidate: ReadonlyMap<string, ReadonlySet<string>>;
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

export function validateReinvestigationTaskKeys(artifact: SkepticArtifact, runs: readonly Readonly<{
  task_key: string;
  specialist_capability: string;
}>[]): void {
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
