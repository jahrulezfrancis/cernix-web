import { describe, expect, it } from "vitest";
import { PublicSafeErrorEnvelopeSchema } from "@/lib/contracts/investigation-api";
import { ApplicationError, toPublicSafeError } from "./errors";

describe("application errors", () => {
  it("produces a schema-valid safe public envelope with field issues", () => {
    const cause = new Error("token=secret stack detail");
    const error = new ApplicationError("invalid_claim", {
      message: "The claim is invalid.",
      issues: [{ field: "claim.statement", code: "too_small", message: "Enter a claim." }],
      cause,
    });
    const publicError = toPublicSafeError(error);

    expect(publicError.httpStatus).toBe(422);
    expect(PublicSafeErrorEnvelopeSchema.parse(publicError.body)).toEqual(publicError.body);
    expect(JSON.stringify(publicError.body)).not.toContain("secret");
    expect(JSON.stringify(publicError.body)).not.toContain("stack");
    expect(error.causeForLogging).toBe(cause);
  });

  it("maps unknown failures to a generic internal error", () => {
    const publicError = toPublicSafeError(new Error("database password"));
    expect(publicError).toEqual({
      httpStatus: 500,
      body: {
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
        },
      },
    });
    expect(JSON.stringify(publicError)).not.toContain("password");
  });
});
