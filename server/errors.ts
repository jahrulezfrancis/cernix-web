import { z, type ZodError } from "zod";
import {
  PUBLIC_VALIDATION_ISSUE_MESSAGES,
  PUBLIC_ERROR_DEFINITIONS,
  PublicSafeErrorEnvelopeSchema,
  type PublicErrorCode,
  type PublicSafeErrorEnvelope,
  type PublicValidationIssue,
  type PublicValidationIssueCode,
} from "@/lib/contracts/investigation-api";

export { PUBLIC_ERROR_DEFINITIONS } from "@/lib/contracts/investigation-api";

export type ApplicationErrorOptions = {
  issues?: readonly ApplicationValidationIssue[];
  cause?: unknown;
};

export type ApplicationValidationIssue = Readonly<{
  field: string;
  code: PublicValidationIssueCode;
}>;

const GENERIC_FIELD = "input";
const SAFE_FIELD_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function sanitizeFieldPath(path: PropertyKey[]): string {
  if (path.length === 0 || path.length > 8) return GENERIC_FIELD;
  const segments = path.map((segment, index) => {
    if (
      index > 0 &&
      typeof segment === "number" &&
      Number.isInteger(segment) &&
      segment >= 0 &&
      segment <= 9999
    ) {
      return String(segment);
    }
    if (typeof segment === "string" && SAFE_FIELD_SEGMENT.test(segment)) return segment;
    return null;
  });
  return segments.every((segment): segment is string => segment !== null)
    ? segments.join(".")
    : GENERIC_FIELD;
}

function sanitizeApplicationField(field: string): string {
  return sanitizeFieldPath(field.split("."));
}

function safeIssueCode(issue: z.core.$ZodIssue): PublicValidationIssueCode {
  switch (issue.code) {
    case "invalid_type": return "invalid_type";
    case "too_small": return "too_small";
    case "too_big": return "too_big";
    case "invalid_format": return "invalid_format";
    case "invalid_value": return "invalid_value";
    case "unrecognized_keys": return "unknown_field";
    default: return "invalid_input";
  }
}

export function toSafeValidationIssues(error: ZodError): PublicValidationIssue[] {
  return error.issues.slice(0, 50).map((issue) => {
    const code = safeIssueCode(issue);
    return Object.freeze({
      field: sanitizeFieldPath(issue.path),
      code,
      message: PUBLIC_VALIDATION_ISSUE_MESSAGES[code],
    });
  });
}

export class ApplicationError extends Error {
  readonly code: PublicErrorCode;
  readonly httpStatus: number;
  readonly issues?: readonly PublicValidationIssue[];
  private readonly internalCause?: unknown;

  constructor(code: PublicErrorCode, options: ApplicationErrorOptions) {
    const definition = PUBLIC_ERROR_DEFINITIONS[code];
    super(definition.publicMessage);
    this.name = "ApplicationError";
    this.code = code;
    this.httpStatus = definition.httpStatus;
    this.issues = options.issues?.length
      ? Object.freeze(options.issues.slice(0, 50).map((issue) => Object.freeze({
          field: sanitizeApplicationField(issue.field),
          code: issue.code,
          message: PUBLIC_VALIDATION_ISSUE_MESSAGES[issue.code],
        })))
      : undefined;
    Object.defineProperty(this, "internalCause", {
      configurable: false,
      enumerable: false,
      value: options.cause,
      writable: false,
    });
  }

  get causeForLogging() {
    return this.internalCause;
  }

  toPublicEnvelope(): PublicSafeErrorEnvelope {
    return PublicSafeErrorEnvelopeSchema.parse({
      error: {
        code: this.code,
        message: PUBLIC_ERROR_DEFINITIONS[this.code].publicMessage,
        ...(this.issues?.length
          ? { issues: this.issues.map((issue) => ({ ...issue })) }
          : {}),
      },
    });
  }

  toJSON(): PublicSafeErrorEnvelope {
    return this.toPublicEnvelope();
  }
}

export function toPublicSafeError(error: unknown): {
  httpStatus: number;
  body: PublicSafeErrorEnvelope;
} {
  if (error instanceof ApplicationError) {
    return {
      httpStatus: PUBLIC_ERROR_DEFINITIONS[error.code].httpStatus,
      body: error.toPublicEnvelope(),
    };
  }
  return {
    httpStatus: PUBLIC_ERROR_DEFINITIONS.internal_error.httpStatus,
    body: {
      error: {
        code: "internal_error",
        message: PUBLIC_ERROR_DEFINITIONS.internal_error.publicMessage,
      },
    },
  };
}
