import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import { parseGitHubSnapshotConfig } from "./config";
import { buildRepositorySnapshot } from "./snapshotter";

describe("opt-in pinned public GitHub smoke", () => {
  it("resolves only the explicitly pinned commit", async (context) => {
    const environment = process.env;
    const owner = environment.GITHUB_LIVE_OWNER, repository = environment.GITHUB_LIVE_REPOSITORY;
    const commit = environment.GITHUB_LIVE_COMMIT?.toLowerCase();
    if (environment.CERNIX_GITHUB_LIVE_SMOKE !== "1" || !owner || !repository || !commit) {
      context.skip(); return;
    }
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("GITHUB_LIVE_COMMIT must be one exact commit SHA.");
    const config = parseGitHubSnapshotConfig(environment);
    const snapshot = await buildRepositorySnapshot({ owner, repository, requestedRef: commit,
      client: new GitHubClient(config), config });
    expect(snapshot.commitSha).toBe(commit);
    expect(snapshot.requestedRef).toBe(commit);
  });
});
