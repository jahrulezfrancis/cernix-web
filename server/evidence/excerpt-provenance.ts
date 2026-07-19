import type { EvidenceTaskResult } from "@/lib/contracts/evidence-candidate";
import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { ApplicationError } from "@/server/errors";

function excerptTextFromFile(normalizedText: string, lineStart: number, lineEnd: number): string {
  const lines = normalizedText.split("\n");
  if (lineStart < 1 || lineEnd < lineStart || lineEnd > lines.length) throw new ApplicationError("malformed_input", {});
  return lines.slice(lineStart - 1, lineEnd).join("\n");
}

function admittedFile(snapshot: PersistedRepositorySnapshot, path: string) {
  const entry = snapshot.entries.find((item) => item.path === path);
  if (!entry || entry.decision !== "admitted" || !entry.file) return null;
  return entry.file;
}

export function validateEvidenceExcerptProvenance(result: EvidenceTaskResult, snapshot: PersistedRepositorySnapshot): void {
  for (const candidate of result.candidates) {
    for (const excerpt of candidate.excerpts) {
      const file = admittedFile(snapshot, excerpt.path);
      if (!file) throw new ApplicationError("malformed_input", {});
      if (file.normalizedSha256 !== excerpt.normalizedSha256) throw new ApplicationError("malformed_input", {});
      const expected = excerptTextFromFile(file.normalizedText, excerpt.lineStart, excerpt.lineEnd);
      if (expected !== excerpt.excerptText) throw new ApplicationError("malformed_input", {});
    }
  }
}
