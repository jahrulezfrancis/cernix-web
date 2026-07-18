import { describe, expect, it } from "vitest";
import {
  BACKEND_LIFECYCLE_TRANSITIONS,
  BackendLifecycleStatusSchema,
  CLAIM_STATEMENT_MAX_LENGTH,
  ClaimApprovalRequestSchema,
  CreateInvestigationRequestSchema,
  IdempotencyKeySchema,
  InvestigationIdSchema,
  StartInvestigationResponseSchema,
  TERMINAL_BACKEND_STATUSES,
  canTransitionBackendLifecycle,
} from "./investigation-api";

const id = "8c8bc9ee-7c3e-4e2d-8f3e-a2ed0b7e1157";

describe("investigation API contracts", () => {
  it("accepts a strict one-claim create request", () => {
    expect(CreateInvestigationRequestSchema.parse({
      repositoryUrl: " https://github.com/acme/widget ",
      repositoryRef: " main ",
      claim: { statement: " The project verifies every pull request. " },
    })).toEqual({
      repositoryUrl: "https://github.com/acme/widget",
      repositoryRef: "main",
      claim: { statement: "The project verifies every pull request." },
    });
  });

  it("accepts claim approval and a snapshotting start response", () => {
    expect(ClaimApprovalRequestSchema.parse({
      statement: "A bounded technical claim",
      preservedQualifiers: [" every request "],
      approved: true,
    }).preservedQualifiers).toEqual(["every request"]);
    expect(StartInvestigationResponseSchema.parse({
      investigationId: id,
      status: "snapshotting",
      eventCursor: 0,
    }).status).toBe("snapshotting");
  });

  it("rejects whitespace-only, over-limit, and excessive qualifier inputs", () => {
    expect(ClaimApprovalRequestSchema.safeParse({
      statement: " ",
      approved: true,
    }).success).toBe(false);
    expect(ClaimApprovalRequestSchema.safeParse({
      statement: "x".repeat(CLAIM_STATEMENT_MAX_LENGTH + 1),
      approved: true,
    }).success).toBe(false);
    expect(ClaimApprovalRequestSchema.safeParse({
      statement: "valid",
      preservedQualifiers: Array.from({ length: 21 }, (_, index) => `q${index}`),
      approved: true,
    }).success).toBe(false);
  });

  it("rejects unknown request keys", () => {
    expect(CreateInvestigationRequestSchema.safeParse({
      repositoryUrl: "https://github.com/acme/widget",
      claim: { statement: "valid", unexpected: true },
    }).success).toBe(false);
    expect(ClaimApprovalRequestSchema.safeParse({
      statement: "valid",
      approved: true,
      unexpected: true,
    }).success).toBe(false);
  });

  it("requires UUID investigation and idempotency identifiers", () => {
    expect(InvestigationIdSchema.safeParse(id).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse(id).success).toBe(true);
    expect(InvestigationIdSchema.safeParse("inv-123").success).toBe(false);
    expect(IdempotencyKeySchema.safeParse("retry-me").success).toBe(false);
  });

  it("encodes the exact authoritative lifecycle and terminal behavior", () => {
    expect(BackendLifecycleStatusSchema.options).toEqual([
      "awaiting_claim_review",
      "snapshotting",
      "planning",
      "investigating",
      "challenging",
      "reinvestigating",
      "judging",
      "completed",
      "completed_with_limitations",
      "failed",
    ]);
    expect(BACKEND_LIFECYCLE_TRANSITIONS.challenging).toEqual([
      "judging",
      "reinvestigating",
      "failed",
    ]);
    expect(canTransitionBackendLifecycle("awaiting_claim_review", "snapshotting")).toBe(true);
    expect(canTransitionBackendLifecycle("snapshotting", "planning")).toBe(true);
    expect(canTransitionBackendLifecycle("judging", "completed")).toBe(true);
    expect(canTransitionBackendLifecycle("completed", "investigating")).toBe(false);
    expect(TERMINAL_BACKEND_STATUSES).toEqual(new Set([
      "completed",
      "completed_with_limitations",
      "failed",
    ]));
    for (const status of TERMINAL_BACKEND_STATUSES) {
      expect(BACKEND_LIFECYCLE_TRANSITIONS[status]).toEqual([]);
    }
  });
});
