import { describe, expect, it } from "vitest";
import { ApplicationError } from "@/server/errors";
import { classifyDatabaseError } from "@/server/db/errors";
import { PublicInvestigationEventSchema } from "./events";

describe("database error classification", () => {
  it.each(["ECONNREFUSED", "08006", "57P01"])("classifies %s as unavailable", (code) => {
    const cause = Object.assign(new Error("private"), { code });
    const error = classifyDatabaseError(cause);
    expect(error.code).toBe("dependency_unavailable");
    expect(error.causeForLogging).toBe(cause);
  });

  it("preserves application errors and treats non-connectivity SQL errors as internal", () => {
    const application = new ApplicationError("conflict", {});
    expect(classifyDatabaseError(application)).toBe(application);
    expect(classifyDatabaseError({ code: "23505" }).code).toBe("internal_error");
  });
});

describe("public investigation events", () => {
  it("accepts the five supported event shapes", () => {
    const events = [
      { type: "investigation_created", stage: "awaiting_claim_review", payload: { claimCount: 1 } },
      { type: "claim_approved", stage: "awaiting_claim_review", payload: { qualifierCount: 0 } },
      { type: "claim_edited", stage: "awaiting_claim_review", payload: { qualifierCount: 20 } },
      { type: "investigation_started", stage: "snapshotting", payload: { jobKind: "repository_snapshot" } },
      { type: "lifecycle_transitioned", stage: "planning", payload: { from: "snapshotting", to: "planning" } },
    ];
    for (const event of events) expect(PublicInvestigationEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    { type: "investigation_created", stage: "awaiting_claim_review", payload: { claimCount: 2 } },
    { type: "claim_approved", stage: "awaiting_claim_review", payload: { qualifierCount: 21 } },
    { type: "investigation_started", stage: "snapshotting", payload: { jobKind: "other" } },
    { type: "lifecycle_transitioned", stage: "planning", payload: { from: "planning", to: "planning" } },
    { type: "lifecycle_transitioned", stage: "planning", payload: { from: "snapshotting", to: "investigating" } },
    { type: "claim_edited", stage: "awaiting_claim_review", payload: { qualifierCount: 1, secret: "x" } },
  ])("rejects malformed public event %#", (event) => {
    expect(PublicInvestigationEventSchema.safeParse(event).success).toBe(false);
  });
});
