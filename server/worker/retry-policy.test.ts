import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { SnapshotError, type SnapshotFailureCode } from "@/server/github/errors";
import { classifySnapshotJobFailure } from "./retry-policy";

const config = { baseSeconds: 5, maximumSeconds: 20 };
describe("snapshot worker retry policy", () => {
  it.each([
    "github_rate_limited", "github_unavailable", "snapshot_deadline_exceeded",
  ] satisfies SnapshotFailureCode[])("retries the classified transient %s failure", (code) => {
    expect(classifySnapshotJobFailure(new SnapshotError(code), 1, 4, config)).toEqual({
      disposition: "retry", failureCode: code, delaySeconds: 5,
    });
  });

  it.each([
    "repository_not_found", "repository_private", "repository_archived", "repository_disabled",
    "repository_too_large", "ref_not_found", "malformed_github_response", "github_redirect_rejected",
    "request_budget_exceeded", "tree_entry_limit_exceeded", "tree_depth_exceeded", "tree_cycle_detected",
    "duplicate_tree_path", "blob_verification_failed", "github_authentication_failed",
  ] satisfies SnapshotFailureCode[])("fails the deterministic %s failure", (code) => {
    expect(classifySnapshotJobFailure(new SnapshotError(code), 1, 4, config)).toEqual({
      disposition: "fail", failureCode: code, delaySeconds: null,
    });
  });

  it("classifies public codes without inspecting message text", () => {
    const transient = new ApplicationError("dependency_unavailable", { cause: new Error("private provider body") });
    const terminal = new ApplicationError("invalid_repository_url", {});
    expect(classifySnapshotJobFailure(transient, 2, 4, config)).toMatchObject({ disposition: "retry", delaySeconds: 10 });
    expect(classifySnapshotJobFailure(terminal, 2, 4, config)).toEqual({ disposition: "fail", failureCode: "invalid_repository_url", delaySeconds: null });
    expect(classifySnapshotJobFailure(new Error("rate limited"), 1, 4, config).failureCode).toBe("internal_error");
  });

  it.each([
    ["malformed_input", "fail"], ["invalid_repository_url", "fail"], ["invalid_claim", "fail"],
    ["invalid_idempotency_key", "fail"], ["invalid_lifecycle_transition", "fail"], ["not_found", "fail"],
    ["conflict", "fail"], ["rate_limited", "retry"], ["dependency_unavailable", "retry"], ["internal_error", "retry"],
  ] as const)("classifies the public %s code as %s", (code, disposition) => {
    expect(classifySnapshotJobFailure(new ApplicationError(code, {}), 1, 4, config).disposition).toBe(disposition);
  });

  it("uses persisted attempts for deterministic capped backoff and exhaustion", () => {
    const error = new ApplicationError("rate_limited", {});
    expect([1, 2, 3].map((attempt) => classifySnapshotJobFailure(error, attempt, 4, config).delaySeconds)).toEqual([5, 10, 20]);
    expect(classifySnapshotJobFailure(error, 4, 4, config)).toEqual({ disposition: "fail", failureCode: "attempts_exhausted", delaySeconds: null });
    expect(classifySnapshotJobFailure(error, 3, 3, config)).toMatchObject({ disposition: "fail" });
  });

  it("classifies owned shutdown as a bounded retry unless exhausted", () => {
    expect(classifySnapshotJobFailure(undefined, 1, 4, config, true)).toEqual({ disposition: "retry", failureCode: "worker_shutdown", delaySeconds: 5 });
    expect(classifySnapshotJobFailure(undefined, 4, 4, config, true)).toEqual({ disposition: "fail", failureCode: "attempts_exhausted", delaySeconds: null });
  });
});
