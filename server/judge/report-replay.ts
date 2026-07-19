import type { JudgeArtifact } from "@/lib/contracts/judgment-report";
import { hashJudgeArtifact, validateJudgeArtifact } from "@/lib/contracts/judgment-report";
import { ApplicationError } from "@/server/errors";

export function rebuildJudgeArtifactFromRows(report: Readonly<{
  investigation_id: string;
  manifest_hash_sha256: string;
  commit_sha: string;
  completion_disposition: JudgeArtifact["completionDisposition"];
  report_summary: string;
  canonical_artifact: unknown;
}>): JudgeArtifact {
  const stored = typeof report.canonical_artifact === "string"
    ? JSON.parse(report.canonical_artifact) as unknown
    : report.canonical_artifact;
  const artifact = validateJudgeArtifact(stored);
  if (artifact.investigationId !== report.investigation_id ||
      artifact.snapshotManifestHash !== report.manifest_hash_sha256 ||
      artifact.commitSha !== report.commit_sha ||
      artifact.completionDisposition !== report.completion_disposition ||
      artifact.reportSummary !== report.report_summary) {
    throw new ApplicationError("internal_error", {});
  }
  return artifact;
}

export function verifyPersistedReportArtifact(report: Readonly<{
  investigation_id: string;
  manifest_hash_sha256: string;
  commit_sha: string;
  completion_disposition: JudgeArtifact["completionDisposition"];
  report_summary: string;
  artifact_hash_sha256: string;
  canonical_artifact: unknown;
}>): JudgeArtifact {
  const artifact = rebuildJudgeArtifactFromRows(report);
  const hash = hashJudgeArtifact(artifact);
  if (hash !== report.artifact_hash_sha256) throw new ApplicationError("internal_error", {});
  return artifact;
}
