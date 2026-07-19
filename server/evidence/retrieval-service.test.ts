import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { retrieveFromSnapshot, retrievalBundleWithinLimit } from "./retrieval-service";

const normalized = "# Widget\nREADME content\n";
const rawSha = createHash("sha256").update("raw").digest("hex");
const normalizedSha = createHash("sha256").update(normalized).digest("hex");

function snapshot(): PersistedRepositorySnapshot {
  return {
    manifestHashSha256: "a".repeat(64), commitSha: "b".repeat(40), inspectedEntryCount: 1, admittedFileCount: 1,
    excludedEntryCount: 0, totalAdmittedBytes: String(Buffer.byteLength(normalized, "utf8")),
    entries: [{
      path: "README.md", mode: "100644", objectType: "blob", objectSha: "c".repeat(40), reportedSize: "20",
      decision: "admitted", exclusionReason: null, manifestOrder: 0,
      file: { rawSha256: rawSha, normalizedSha256: normalizedSha, byteCount: normalized.length, lineCount: 2,
        normalizedText: normalized, detectedLanguage: "Markdown" },
    }],
  } as unknown as PersistedRepositorySnapshot;
}

describe("snapshot retrieval service", () => {
  const config = { maxExcerpts: 5, maxExcerptBytes: 4_096, maxMatchesPerTerm: 2, maxContextBytes: 10_000, excerptContextLines: 1 };

  it("returns bounded lexical matches for query terms", () => {
    const bundle = retrieveFromSnapshot(snapshot(), ["readme", "widget"], config);
    expect(bundle.queryTerms).toEqual(["readme", "widget"]);
    expect(bundle.matches.length).toBeGreaterThan(0);
    expect(bundle.matches[0]).toMatchObject({ path: "README.md", matchedTerm: "readme", normalizedSha256: normalizedSha });
  });

  it("reports when serialized retrieval exceeds the context budget", () => {
    const bundle = retrieveFromSnapshot(snapshot(), ["readme"], { ...config, maxContextBytes: 32 });
    expect(retrievalBundleWithinLimit(bundle, 32)).toBe(false);
  });
});
