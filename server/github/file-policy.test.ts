import { describe, expect, it } from "vitest";
import type { GitHubSnapshotConfig } from "./config";
import { applyAdmissionPolicy, isUnambiguouslyNormalizedPath, primaryExclusion } from "./file-policy";

const config: GitHubSnapshotConfig = { token: null, apiVersion: "2026-03-10", requestTimeoutMs: 100,
  snapshotDeadlineMs: 1_000, maxRequests: 50, maxInspectedEntries: 100, maxAdmittedFiles: 1,
  maxFileBytes: 10, maxTotalTextBytes: 8, maxLinesPerFile: 10, maxTreeDepth: 5, maxConcurrency: 2 };
const entry = (path: string, mode = "100644", type = "blob", size: string | null = "1") => ({ path, mode, type, sha: "a".repeat(40), reportedSize: size });

describe("admission policy v1", () => {
  it.each([
    [entry("src", "040000", "tree", null), "tree"], [entry("module", "160000", "commit", null), "submodule"],
    [entry("link", "120000", "blob"), "symlink"], [entry("weird", "100644", "tree"), "malformed_git_entry"],
    [entry("../escape.ts"), "unsafe_path"], [entry("dist/code.ts"), "generated_directory"],
    [entry("node_modules/pkg/index.ts"), "dependency_directory"], [entry("config/.env.prod"), "secret_path"],
    [entry("image.png"), "unsupported_file_type"], [entry("package-lock.json"), "lockfile"],
    [entry("app.min.js"), "minified_bundle"], [entry("app.js.map"), "source_map"],
    [entry("large.ts", "100644", "blob", "11"), "reported_file_too_large"],
  ])("assigns a stable primary reason to %o", (candidate, reason) => {
    expect(primaryExclusion(candidate, config)).toBe(reason);
  });

  it("applies byte-wise ordering, file-count, and total-byte limits deterministically", () => {
    const decisions = applyAdmissionPolicy([entry("z.ts", "100644", "blob", "1"), entry("a.ts", "100644", "blob", "8"), entry("b.ts", "100644", "blob", "1")], config);
    expect(decisions.map((value) => [value.path, value.exclusionReason])).toEqual([
      ["a.ts", null], ["b.ts", "file_count_limit"], ["z.ts", "file_count_limit"],
    ]);
  });

  it("rejects ambiguous path forms without filesystem materialization", () => {
    for (const path of ["/absolute", "a\\b", "a//b", "a/./b", "a/../b", "bad\u0000name", "e\u0301.ts"])
      expect(isUnambiguouslyNormalizedPath(path)).toBe(false);
    expect(isUnambiguouslyNormalizedPath("src/é.ts")).toBe(true);
  });
});
