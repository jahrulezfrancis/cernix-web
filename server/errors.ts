import type {
  PublicErrorCode,
  PublicSafeErrorEnvelope,
  PublicValidationIssue,
} from "@/lib/contracts/investigation-api";

const HTTP_STATUS_BY_CODE: Readonly<Record<PublicErrorCode, number>> = {
  malformed_input: 400,
  invalid_repository_url: 422,
  invalid_claim: 422,
  invalid_idempotency_key: 422,
  invalid_lifecycle_transition: 409,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  dependency_unavailable: 503,
  internal_error: 500,
};

export type ApplicationErrorOptions = {
  message: string;
  httpStatus?: number;
  issues?: PublicValidationIssue[];
  cause?: unknown;
};

export class ApplicationError extends Error {
  readonly code: PublicErrorCode;
  readonly httpStatus: number;
  readonly issues?: PublicValidationIssue[];
  private readonly internalCause?: unknown;

  constructor(code: PublicErrorCode, options: ApplicationErrorOptions) {
    super(options.message);
    this.name = "ApplicationError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? HTTP_STATUS_BY_CODE[code];
    this.issues = options.issues;
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
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues?.length ? { issues: this.issues } : {}),
      },
    };
  }
}

export function toPublicSafeError(error: unknown): {
  httpStatus: number;
  body: PublicSafeErrorEnvelope;
} {
  if (error instanceof ApplicationError) {
    return {
      httpStatus: error.httpStatus,
      body: error.toPublicEnvelope(),
    };
  }
  return {
    httpStatus: HTTP_STATUS_BY_CODE.internal_error,
    body: {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
      },
    },
  };
}
