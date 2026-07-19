import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EvidenceTaskResult } from "@/lib/contracts/evidence-candidate";
import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { ApplicationError } from "@/server/errors";
import { validateEvidenceExcerptProvenance } from "./excerpt-provenance";

const normalized = "# Widget\nREADME content\n";
const normalizedSha = createHash("sha256").update(normalized).digest("hex");

function snapshot(): PersistedRepositorySnapshot {
  return {
    id: "snap", investigationId: "inv", githubRepositoryId: "1", canonicalOwner: "Acme",
    canonicalRepository: "Widget", canonicalUrl: "https://github.com/Acme/Widget", defaultBranch: "main",
    requestedRef: null, resolvedRef: "main", commitSha: "b".repeat(40), rootTreeSha: "c".repeat(40),
    manifestSchemaVersion: 1, admissionPolicyVersion: 1, manifestHashSha256: "a".repeat(64),
    inspectedEntryCount: 1, admittedFileCount: 1, excludedEntryCount: 0, totalAdmittedBytes: "24", createdAt: new Date(),
    entries: [{
      id: "entry", path: "README.md", mode: "100644", objectType: "blob", objectSha: "d".repeat(40),
      reportedSize: "24", decision: "admitted", exclusionReason: null, manifestOrder: 0,
      file: { rawContent: new Uint8Array(), normalizedText: normalized, rawSha256: "e".repeat(64),
        normalizedSha256: normalizedSha, byteCount: normalized.length, lineCount: 2, detectedLanguage: "Markdown" },
    }],
  };
}

function result(overrides: Partial<EvidenceTaskResult["candidates"][number]["excerpts"][number]> = {}): EvidenceTaskResult {
  return {
    taskKey: "task_readme", claimId: "33333333-3333-4333-8333-333333333333",
    candidates: [{
      id: "cand_readme", obligationKeys: ["obl_readme"], evidenceType: "repository_structure",
      observation: "README exists.", strength: "moderate",
      excerpts: [{
        path: "README.md", lineStart: 1, lineEnd: 1, normalizedSha256: normalizedSha, excerptText: "# Widget",
        ...overrides,
      }],
    }],
    gaps: [], counterevidence: [],
  };
}

describe("evidence excerpt provenance", () => {
  it("accepts excerpts grounded in the persisted snapshot", () => {
    expect(() => validateEvidenceExcerptProvenance(result(), snapshot())).not.toThrow();
  });

  it("rejects unknown paths, mismatched hashes, and fabricated excerpt text", () => {
    expect(() => validateEvidenceExcerptProvenance(result({ path: "missing.md" }), snapshot()))
      .toThrow(ApplicationError);
    expect(() => validateEvidenceExcerptProvenance(result({ normalizedSha256: "f".repeat(64) }), snapshot()))
      .toThrow(ApplicationError);
    expect(() => validateEvidenceExcerptProvenance(result({ excerptText: "fabricated" }), snapshot()))
      .toThrow(ApplicationError);
    expect(() => validateEvidenceExcerptProvenance(result({ lineStart: 9, lineEnd: 9 }), snapshot()))
      .toThrow(ApplicationError);
  });
});
