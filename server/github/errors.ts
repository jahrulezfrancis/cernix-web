import { ApplicationError } from "@/server/errors";

export type SnapshotFailureCode =
  | "github_authentication_failed" | "github_rate_limited" | "github_unavailable"
  | "repository_not_found" | "repository_private" | "repository_archived"
  | "repository_disabled" | "repository_too_large" | "ref_not_found"
  | "malformed_github_response" | "github_redirect_rejected" | "request_budget_exceeded"
  | "snapshot_deadline_exceeded" | "tree_entry_limit_exceeded" | "tree_depth_exceeded"
  | "tree_cycle_detected" | "duplicate_tree_path" | "blob_verification_failed";

const PUBLIC_CODE: Record<SnapshotFailureCode, ConstructorParameters<typeof ApplicationError>[0]> = {
  github_authentication_failed: "dependency_unavailable", github_rate_limited: "rate_limited",
  github_unavailable: "dependency_unavailable", repository_not_found: "not_found",
  repository_private: "invalid_repository_url", repository_archived: "invalid_repository_url",
  repository_disabled: "invalid_repository_url", repository_too_large: "invalid_repository_url",
  ref_not_found: "not_found", malformed_github_response: "dependency_unavailable",
  github_redirect_rejected: "dependency_unavailable", request_budget_exceeded: "dependency_unavailable",
  snapshot_deadline_exceeded: "dependency_unavailable", tree_entry_limit_exceeded: "invalid_repository_url",
  tree_depth_exceeded: "invalid_repository_url", tree_cycle_detected: "dependency_unavailable",
  duplicate_tree_path: "dependency_unavailable", blob_verification_failed: "dependency_unavailable",
};

export class SnapshotError extends ApplicationError {
  readonly failureCode: SnapshotFailureCode;
  constructor(failureCode: SnapshotFailureCode, cause?: unknown) {
    super(PUBLIC_CODE[failureCode], { cause });
    this.name = "SnapshotError";
    this.failureCode = failureCode;
  }
}
