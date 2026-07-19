import "server-only";
import { getDatabase } from "@/server/db/database";
import { RepositorySnapshotRepository } from "@/server/persistence/repository-snapshot-repository";
import { GitHubClient, type FetchImplementation } from "./client";
import { readGitHubSnapshotConfig } from "./server-config";
import { RepositorySnapshotService } from "./snapshot-service";
import { buildRepositorySnapshot } from "./snapshotter";

export function createRepositorySnapshotService(options: { fetchImplementation?: FetchImplementation } = {}): RepositorySnapshotService {
  const config = readGitHubSnapshotConfig();
  return new RepositorySnapshotService(new RepositorySnapshotRepository(getDatabase()), (input) => {
    const client = new GitHubClient(config, options.fetchImplementation);
    return buildRepositorySnapshot({ ...input, client, config });
  });
}
