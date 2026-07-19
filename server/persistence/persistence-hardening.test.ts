import { describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { ApplicationError, toPublicSafeError } from "@/server/errors";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { PublicInvestigationEventSchema } from "./events";
import { InvestigationRepository } from "./investigation-repository";

describe("database error classification", () => {
  it.each(["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "08006", "57P01"])(
    "classifies runtime-shaped %s errors as unavailable", (code) => {
    const cause = Object.assign(new Error("private host and SQL"), {
      code, constraint: "private_constraint", detail: "password=secret", query: "select private",
    });
    const error = classifyDatabaseError(cause);
    expect(error.code).toBe("dependency_unavailable");
    expect(error.causeForLogging).toBe(cause);
    expect(JSON.stringify(toPublicSafeError(error))).not.toMatch(/private|secret|constraint|select/i);
  });

  it("preserves known domain errors unchanged", () => {
    const application = new ApplicationError("conflict", {});
    expect(classifyDatabaseError(application)).toBe(application);
  });

  it.each([
    Object.assign(new Error("unexpected unique constraint"), { code: "23505", constraint: "unknown_unique" }),
    Object.assign(new Error("unknown SQLSTATE"), { code: "XX999" }),
    new TypeError("row mapping defect"),
    new Error("plain programming failure"),
  ])("maps unknown and programming failures to internal_error", (cause) => {
    const error = classifyDatabaseError(cause);
    expect(error.code).toBe("internal_error");
    expect(error.causeForLogging).toBe(cause);
    expect(JSON.stringify(toPublicSafeError(error))).not.toMatch(/unique|SQLSTATE|mapping|programming|constraint/i);
  });

  it("rejects an invalid cursor before attempting any database query", async () => {
    const inaccessibleDatabase = {} as Kysely<Database>;
    const repository = new InvestigationRepository(inaccessibleDatabase);
    await expect(repository.getEvents("8c8bc9ee-7c3e-4e2d-8f3e-a2ed0b7e1157", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "01"))
      .rejects.toMatchObject({ code: "malformed_input" });
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
