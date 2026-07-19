import { describe, expect, it } from "vitest";
import { parseGitHubSnapshotConfig } from "./config";

describe("GitHub snapshot configuration", () => {
  it("uses conservative anonymous defaults without reading a token eagerly", () => {
    const config = parseGitHubSnapshotConfig({});
    expect(config).toMatchObject({ token: null, apiVersion: "2026-03-10", requestTimeoutMs: 10_000,
      snapshotDeadlineMs: 90_000, maxRequests: 50, maxInspectedEntries: 10_000,
      maxAdmittedFiles: 1_500, maxFileBytes: 262_144, maxTotalTextBytes: 10_485_760,
      maxLinesPerFile: 20_000, maxTreeDepth: 64, maxConcurrency: 4 });
  });

  it("selects the authenticated budget and validates every numeric bound", () => {
    expect(parseGitHubSnapshotConfig({ GITHUB_TOKEN: " read-only ", GITHUB_MAX_REQUESTS_AUTHENTICATED: "123" }))
      .toMatchObject({ token: "read-only", maxRequests: 123 });
    for (const environment of [
      { GITHUB_MAX_CONCURRENCY: "0" }, { GITHUB_MAX_FILE_BYTES: "not-a-number" },
      { GITHUB_MAX_REQUESTS_ANONYMOUS: "5001" }, { GITHUB_API_VERSION: "latest" },
      { GITHUB_TOKEN: `token\nheader` },
    ]) expect(() => parseGitHubSnapshotConfig(environment)).toThrow();
  });
});
