import { ApplicationError } from "@/server/errors";

export type GitHubSnapshotConfig = Readonly<{
  token: string | null;
  apiVersion: string;
  requestTimeoutMs: number;
  snapshotDeadlineMs: number;
  maxRequests: number;
  maxInspectedEntries: number;
  maxAdmittedFiles: number;
  maxFileBytes: number;
  maxTotalTextBytes: number;
  maxLinesPerFile: number;
  maxTreeDepth: number;
  maxConcurrency: number;
}>;

const API_VERSION = /^\d{4}-\d{2}-\d{2}$/;
type SnapshotEnvironment = Readonly<Record<string, string | undefined>>;
function integer(environment: SnapshotEnvironment, name: string, fallback: number, maximum: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new ApplicationError("dependency_unavailable", {});
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ApplicationError("dependency_unavailable", {});
  }
  return value;
}

export function parseGitHubSnapshotConfig(environment: SnapshotEnvironment): GitHubSnapshotConfig {
  const apiVersion = environment.GITHUB_API_VERSION || "2026-03-10";
  if (!API_VERSION.test(apiVersion)) throw new ApplicationError("dependency_unavailable", {});
  const token = environment.GITHUB_TOKEN?.trim() || null;
  if (token && (token.length > 512 || /[\u0000-\u001f\u007f]/.test(token))) throw new ApplicationError("dependency_unavailable", {});
  return Object.freeze({
    token,
    apiVersion,
    requestTimeoutMs: integer(environment, "GITHUB_REQUEST_TIMEOUT_MS", 10_000, 60_000),
    snapshotDeadlineMs: integer(environment, "GITHUB_SNAPSHOT_DEADLINE_MS", 90_000, 300_000),
    maxRequests: integer(environment, token ? "GITHUB_MAX_REQUESTS_AUTHENTICATED" : "GITHUB_MAX_REQUESTS_ANONYMOUS", token ? 2_000 : 50, 5_000),
    maxInspectedEntries: integer(environment, "GITHUB_MAX_INSPECTED_ENTRIES", 10_000, 50_000),
    maxAdmittedFiles: integer(environment, "GITHUB_MAX_ADMITTED_FILES", 1_500, 5_000),
    maxFileBytes: integer(environment, "GITHUB_MAX_FILE_BYTES", 262_144, 1_048_576),
    maxTotalTextBytes: integer(environment, "GITHUB_MAX_TOTAL_TEXT_BYTES", 10_485_760, 52_428_800),
    maxLinesPerFile: integer(environment, "GITHUB_MAX_LINES_PER_FILE", 20_000, 100_000),
    maxTreeDepth: integer(environment, "GITHUB_MAX_TREE_DEPTH", 64, 128),
    maxConcurrency: integer(environment, "GITHUB_MAX_CONCURRENCY", 4, 16),
  });
}
