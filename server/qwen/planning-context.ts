import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { PlanningError } from "./errors";

export type SnapshotPlanningSummary = Readonly<{
  commitSha: string;
  manifestHashSha256: string;
  inspectedEntryCount: number;
  admittedFileCount: number;
  excludedEntryCount: number;
  totalAdmittedBytes: string;
  extensionCounts: Readonly<Record<string, number>>;
  exclusionReasonCounts: Readonly<Record<string, number>>;
  topLevelDirectories: readonly string[];
  admittedPathSample: readonly string[];
}>;

const MAX_SUMMARY_BYTES = 32_768;
const MAX_PATH_SAMPLE = 100;

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1).toLowerCase() : "(none)";
}

export function buildSnapshotPlanningSummary(snapshot: PersistedRepositorySnapshot, maxBytes = MAX_SUMMARY_BYTES): SnapshotPlanningSummary {
  const extensionCounts: Record<string, number> = {};
  const exclusionReasonCounts: Record<string, number> = {};
  const topLevel = new Set<string>();
  const admittedPaths: string[] = [];
  for (const entry of snapshot.entries) {
    const top = entry.path.split("/")[0] ?? entry.path;
    if (top) topLevel.add(top);
    if (entry.decision === "admitted") {
      const ext = extensionOf(entry.path);
      extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;
      if (admittedPaths.length < MAX_PATH_SAMPLE) admittedPaths.push(entry.path);
    } else if (entry.exclusionReason) {
      exclusionReasonCounts[entry.exclusionReason] = (exclusionReasonCounts[entry.exclusionReason] ?? 0) + 1;
    }
  }
  const summary: SnapshotPlanningSummary = {
    commitSha: snapshot.commitSha,
    manifestHashSha256: snapshot.manifestHashSha256,
    inspectedEntryCount: snapshot.inspectedEntryCount,
    admittedFileCount: snapshot.admittedFileCount,
    excludedEntryCount: snapshot.excludedEntryCount,
    totalAdmittedBytes: snapshot.totalAdmittedBytes,
    extensionCounts,
    exclusionReasonCounts,
    topLevelDirectories: [...topLevel].sort().slice(0, 50),
    admittedPathSample: admittedPaths,
  };
  let serialized = JSON.stringify(summary);
  while (Buffer.byteLength(serialized, "utf8") > maxBytes && summary.admittedPathSample.length > 0) {
    admittedPaths.pop();
    serialized = JSON.stringify({ ...summary, admittedPathSample: [...admittedPaths] });
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new PlanningError("plan_context_invalid");
  return { ...summary, admittedPathSample: [...admittedPaths] };
}

export function serializeSnapshotPlanningSummary(summary: SnapshotPlanningSummary): string {
  return JSON.stringify(summary);
}
