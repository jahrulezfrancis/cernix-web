import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeManifest } from "@/server/github/manifest";
import type { SnapshotEntry } from "@/server/github/contracts";
import { isSnapshotWinnerConflict, validatePersistedSnapshot, type PersistedRepositorySnapshot } from "./repository-snapshot-repository";

const ORIGINAL_GIT_SHA = "ef0493b275aa2080237f676d2ef6559246f56636";
function persisted(raw = Buffer.from("hello\r\n"), objectSha = ORIGINAL_GIT_SHA): PersistedRepositorySnapshot {
  const normalizedText = new TextDecoder("utf-8", { fatal: true }).decode(raw).replace(/\r\n?/g, "\n");
  const rawSha256 = createHash("sha256").update(raw).digest("hex");
  const normalizedSha256 = createHash("sha256").update(normalizedText).digest("hex");
  const manifestEntries: SnapshotEntry[] = [{ path: "README.md", mode: "100644", type: "blob", objectSha,
    reportedSize: String(raw.byteLength), decision: "admitted", exclusionReason: null, rawSha256,
    normalizedSha256, byteCount: raw.byteLength, lineCount: 1 }];
  const identity = { githubRepositoryId: "9007199254740992", canonicalOwner: "Acme", canonicalRepository: "Widget",
    canonicalUrl: "https://github.com/Acme/Widget", defaultBranch: "main", requestedRef: null,
    resolvedRef: "main", commitSha: "a".repeat(40), rootTreeSha: "b".repeat(40) };
  const manifest = canonicalizeManifest({ ...identity, entries: manifestEntries });
  return { id: "11111111-1111-4111-8111-111111111111", investigationId: "22222222-2222-4222-8222-222222222222",
    ...identity, manifestSchemaVersion: 1, admissionPolicyVersion: 1, manifestHashSha256: manifest.hash,
    inspectedEntryCount: 1, admittedFileCount: 1, excludedEntryCount: 0,
    totalAdmittedBytes: String(raw.byteLength), createdAt: new Date("2026-01-01T00:00:00.000Z"),
    entries: [{ id: "33333333-3333-4333-8333-333333333333", path: "README.md", mode: "100644", objectType: "blob",
      objectSha, reportedSize: String(raw.byteLength), decision: "admitted", exclusionReason: null, manifestOrder: 0,
      file: { rawContent: raw, normalizedText, rawSha256, normalizedSha256, byteCount: raw.byteLength,
        lineCount: 1, detectedLanguage: "Markdown" } }] };
}

describe("snapshot uniqueness race classification", () => {
  it("accepts only the named one-snapshot-per-investigation constraint", () => {
    expect(isSnapshotWinnerConflict({ code: "23505", constraint: "repository_snapshots_investigation_unique" })).toBe(true);
    for (const error of [
      { code: "23505" },
      { code: "23505", constraint: "repository_snapshot_entries_path_unique" },
      { code: "23505", constraint: "repository_snapshot_entries_order_unique" },
      { code: "23505", constraint: "repository_snapshot_files_entry_id_key" },
      { code: "23503", constraint: "repository_snapshots_investigation_unique" },
    ]) expect(isSnapshotWinnerConflict(error)).toBe(false);
  });
});

describe("persisted Git object validation", () => {
  it("accepts raw bytes that match the canonical Git blob SHA", () => {
    const snapshot = persisted();
    expect(validatePersistedSnapshot(snapshot, 1)).toBe(snapshot);
  });

  it("rejects a one-byte raw mutation with stale integrity metadata", () => {
    const snapshot = persisted();
    const mutated = { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry,
      file: entry.file ? { ...entry.file, rawContent: Buffer.from("jello\r\n") } : null })) };
    expect(() => validatePersistedSnapshot(mutated, 1)).toThrow(expect.objectContaining({ code: "internal_error" }));
  });

  it("rejects coherent SHA-256 and manifest updates when the Git SHA remains stale", () => {
    const snapshot = persisted(Buffer.from("jello\r\n"));
    expect(() => validatePersistedSnapshot(snapshot, 1)).toThrow(expect.objectContaining({ code: "internal_error" }));
  });

  it("rejects uppercase noncanonical Git object identity", () => {
    const snapshot = persisted(Buffer.from("hello\r\n"), ORIGINAL_GIT_SHA.toUpperCase());
    expect(() => validatePersistedSnapshot(snapshot, 1)).toThrow(expect.objectContaining({ code: "internal_error" }));
  });

  it("rejects unsupported persisted policy versions before interpretation", () => {
    const snapshot = { ...persisted(), admissionPolicyVersion: 2 };
    expect(() => validatePersistedSnapshot(snapshot, 1)).toThrow(expect.objectContaining({ code: "internal_error" }));
  });
});
