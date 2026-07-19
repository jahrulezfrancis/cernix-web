import "server-only";
import { parseGitHubSnapshotConfig, type GitHubSnapshotConfig } from "./config";

export function readGitHubSnapshotConfig(): GitHubSnapshotConfig {
  return parseGitHubSnapshotConfig(process.env);
}
