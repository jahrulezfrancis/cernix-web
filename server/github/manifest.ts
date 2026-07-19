import { createHash } from "node:crypto";
import { ADMISSION_POLICY_VERSION, MANIFEST_SCHEMA_VERSION, type SnapshotArtifact, type SnapshotEntry } from "./contracts";
import type { RepositoryIdentity } from "./contracts";
import { compareUtf8 } from "./file-policy";

type ManifestInput = RepositoryIdentity & {
  requestedRef: string | null; resolvedRef: string; commitSha: string; rootTreeSha: string; entries: readonly SnapshotEntry[];
};

export function canonicalizeManifest(input: ManifestInput): { bytes: Uint8Array; hash: string } {
  const manifest = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    admissionPolicyVersion: ADMISSION_POLICY_VERSION,
    githubRepositoryId: input.githubRepositoryId,
    canonicalOwner: input.canonicalOwner,
    canonicalRepository: input.canonicalRepository,
    requestedRef: input.requestedRef,
    resolvedRef: input.resolvedRef,
    commitSha: input.commitSha,
    rootTreeSha: input.rootTreeSha,
    entries: [...input.entries].sort((a, b) => compareUtf8(a.path, b.path)).map((entry) => ({
      path: entry.path, mode: entry.mode, type: entry.type, objectSha: entry.objectSha,
      reportedSize: entry.reportedSize, decision: entry.decision, exclusionReason: entry.exclusionReason,
      rawSha256: entry.rawSha256, normalizedSha256: entry.normalizedSha256,
      byteCount: entry.byteCount, lineCount: entry.lineCount,
    })),
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}

export function finalizeArtifact(input: ManifestInput): SnapshotArtifact {
  const { bytes, hash } = canonicalizeManifest(input);
  const admitted = input.entries.filter((entry) => entry.decision === "admitted");
  const total = admitted.reduce((sum, entry) => sum + BigInt(entry.byteCount ?? 0), 0n);
  return {
    ...input, manifestSchemaVersion: MANIFEST_SCHEMA_VERSION, admissionPolicyVersion: ADMISSION_POLICY_VERSION,
    canonicalManifest: bytes, manifestHashSha256: hash, inspectedEntryCount: input.entries.length,
    admittedFileCount: admitted.length, excludedEntryCount: input.entries.length - admitted.length,
    totalAdmittedBytes: total.toString(), entries: [...input.entries],
  };
}
