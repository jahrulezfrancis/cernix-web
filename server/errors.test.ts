import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PublicSafeErrorEnvelopeSchema,
  PUBLIC_VALIDATION_ISSUE_MESSAGES,
  type PublicErrorCode,
} from "@/lib/contracts/investigation-api";
import {
  ApplicationError,
  type ApplicationErrorOptions,
  type ApplicationValidationIssue,
  PUBLIC_ERROR_DEFINITIONS,
  toPublicSafeError,
  toSafeValidationIssues,
} from "./errors";

const SECRET = "SECRET_token=https://user:password@example.test/private";

const expectedDefinitions: Record<
  PublicErrorCode,
  { httpStatus: number; publicMessage: string }
> = {
  malformed_input: { httpStatus: 400, publicMessage: "The request is malformed." },
  invalid_repository_url: { httpStatus: 422, publicMessage: "Enter a valid GitHub repository URL." },
  invalid_claim: { httpStatus: 422, publicMessage: "The claim is invalid." },
  invalid_idempotency_key: { httpStatus: 422, publicMessage: "Enter a valid idempotency key." },
  invalid_lifecycle_transition: { httpStatus: 409, publicMessage: "The requested lifecycle transition is not allowed." },
  not_found: { httpStatus: 404, publicMessage: "The requested resource was not found." },
  conflict: { httpStatus: 409, publicMessage: "The request conflicts with the current resource state." },
  rate_limited: { httpStatus: 429, publicMessage: "Too many requests. Try again later." },
  dependency_unavailable: { httpStatus: 503, publicMessage: "A required service is temporarily unavailable." },
  internal_error: { httpStatus: 500, publicMessage: "An unexpected error occurred." },
};

describe("application errors", () => {
  it.each(Object.entries(expectedDefinitions) as [
    PublicErrorCode,
    { httpStatus: number; publicMessage: string },
  ][])("fixes the status and public message for %s", (code, expected) => {
    const error = new ApplicationError(code, {});
    expect(PUBLIC_ERROR_DEFINITIONS[code]).toEqual(expected);
    expect(toPublicSafeError(error)).toEqual({
      httpStatus: expected.httpStatus,
      body: { error: { code, message: expected.publicMessage } },
    });
  });

  it("ignores an attempted construction-time status override", () => {
    const options = { httpStatus: 200 } as ApplicationErrorOptions & {
      httpStatus: number;
    };
    expect(toPublicSafeError(new ApplicationError("invalid_claim", options)).httpStatus).toBe(422);
  });

  it("owns issue data and derives fixed issue messages", () => {
    const issue = { field: "claim.statement", code: "too_small" as const };
    const issues: ApplicationValidationIssue[] = [issue];
    const error = new ApplicationError("invalid_claim", { issues });

    issue.field = SECRET;
    issues.push({ field: "credential", code: "invalid_input" });

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(SECRET);
    expect(JSON.parse(serialized)).toEqual({
      error: {
        code: "invalid_claim",
        message: expectedDefinitions.invalid_claim.publicMessage,
        issues: [{
          field: "claim.statement",
          code: "too_small",
          message: PUBLIC_VALIDATION_ISSUE_MESSAGES.too_small,
        }],
      },
    });
  });

  it("does not serialize a reassigned Error message, causes, stacks, or extra issue messages", () => {
    const unsafeIssue = {
      field: "repositoryUrl",
      code: "invalid_format" as const,
      message: SECRET,
    };
    const cause = new Error(SECRET);
    const error = new ApplicationError("invalid_repository_url", {
      issues: [unsafeIssue],
      cause,
    });
    error.message = SECRET;

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
    expect(serialized).not.toContain("httpStatus");
    expect(error.causeForLogging).toBe(cause);
    expect(PublicSafeErrorEnvelopeSchema.parse(JSON.parse(serialized))).toEqual(
      error.toPublicEnvelope()
    );
  });

  it("maps Zod errors to bounded fixed-message issues without raw values or unsafe paths", () => {
    const schema = z.object({
      claim: z.object({
        statement: z.string().min(10),
      }),
      credential: z.string().superRefine((value, context) => {
        context.addIssue({
          code: "custom",
          path: ["unsafe-key"],
          message: `Rejected ${value}`,
        });
      }),
    }).strict();
    const result = schema.safeParse({
      claim: { statement: "short" },
      credential: SECRET,
      [SECRET]: SECRET,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected schema rejection.");

    const issues = toSafeValidationIssues(result.error);
    const serialized = JSON.stringify(issues);
    expect(issues.length).toBeLessThanOrEqual(50);
    expect(issues).toContainEqual({
      field: "claim.statement",
      code: "too_small",
      message: PUBLIC_VALIDATION_ISSUE_MESSAGES.too_small,
    });
    expect(issues).toContainEqual({
      field: "input",
      code: "invalid_input",
      message: PUBLIC_VALIDATION_ISSUE_MESSAGES.invalid_input,
    });
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("Rejected");
  });

  it("maps unknown failures to a generic internal error", () => {
    const publicError = toPublicSafeError(new Error(SECRET));
    expect(publicError).toEqual({
      httpStatus: 500,
      body: {
        error: {
          code: "internal_error",
          message: expectedDefinitions.internal_error.publicMessage,
        },
      },
    });
    expect(JSON.stringify(publicError)).not.toContain(SECRET);
    expect(PublicSafeErrorEnvelopeSchema.parse(publicError.body)).toEqual(publicError.body);
  });
});
