import { z } from "zod";

export const REPOSITORY_URL_MIN_LENGTH = 1;
export const REPOSITORY_URL_MAX_LENGTH = 2048;
export const REPOSITORY_REF_MIN_LENGTH = 1;
export const REPOSITORY_REF_MAX_LENGTH = 255;
export const CLAIM_STATEMENT_MIN_LENGTH = 1;
export const CLAIM_STATEMENT_MAX_LENGTH = 4000;
export const PRESERVED_QUALIFIER_MIN_LENGTH = 1;
export const PRESERVED_QUALIFIER_MAX_LENGTH = 500;
export const PRESERVED_QUALIFIERS_MAX_COUNT = 20;

const boundedTrimmedString = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export const InvestigationIdSchema = z.uuid();
export type InvestigationId = z.infer<typeof InvestigationIdSchema>;

export const IdempotencyKeySchema = z.uuid();
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const BackendLifecycleStatusSchema = z.enum([
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
export type BackendLifecycleStatus = z.infer<typeof BackendLifecycleStatusSchema>;

export const TERMINAL_BACKEND_STATUSES = new Set<BackendLifecycleStatus>([
  "completed",
  "completed_with_limitations",
  "failed",
]);

export const BACKEND_LIFECYCLE_TRANSITIONS: Readonly<
  Record<BackendLifecycleStatus, readonly BackendLifecycleStatus[]>
> = {
  awaiting_claim_review: ["snapshotting", "failed"],
  snapshotting: ["planning", "failed"],
  planning: ["investigating", "failed"],
  investigating: ["challenging", "failed"],
  challenging: ["judging", "reinvestigating", "failed"],
  reinvestigating: ["judging", "failed"],
  judging: ["completed", "completed_with_limitations", "failed"],
  completed: [],
  completed_with_limitations: [],
  failed: [],
};

export function canTransitionBackendLifecycle(
  from: BackendLifecycleStatus,
  to: BackendLifecycleStatus
) {
  return from === to || BACKEND_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export const RepositoryReferenceInputSchema = z
  .object({
    repositoryUrl: boundedTrimmedString(
      REPOSITORY_URL_MIN_LENGTH,
      REPOSITORY_URL_MAX_LENGTH
    ),
    repositoryRef: boundedTrimmedString(
      REPOSITORY_REF_MIN_LENGTH,
      REPOSITORY_REF_MAX_LENGTH
    ).optional(),
  })
  .strict();
export type RepositoryReferenceInput = z.infer<typeof RepositoryReferenceInputSchema>;

export const ManualClaimInputSchema = z
  .object({
    statement: boundedTrimmedString(
      CLAIM_STATEMENT_MIN_LENGTH,
      CLAIM_STATEMENT_MAX_LENGTH
    ),
  })
  .strict();
export type ManualClaimInput = z.infer<typeof ManualClaimInputSchema>;

export const CreateInvestigationRequestSchema = RepositoryReferenceInputSchema.extend({
  claim: ManualClaimInputSchema,
}).strict();
export type CreateInvestigationRequest = z.infer<
  typeof CreateInvestigationRequestSchema
>;

export const ClaimApprovalRequestSchema = z
  .object({
    statement: boundedTrimmedString(
      CLAIM_STATEMENT_MIN_LENGTH,
      CLAIM_STATEMENT_MAX_LENGTH
    ),
    preservedQualifiers: z
      .array(
        boundedTrimmedString(
          PRESERVED_QUALIFIER_MIN_LENGTH,
          PRESERVED_QUALIFIER_MAX_LENGTH
        )
      )
      .max(PRESERVED_QUALIFIERS_MAX_COUNT)
      .default([]),
    approved: z.literal(true),
  })
  .strict();
export type ClaimApprovalRequest = z.infer<typeof ClaimApprovalRequestSchema>;

export const StartInvestigationResponseSchema = z
  .object({
    investigationId: InvestigationIdSchema,
    status: BackendLifecycleStatusSchema,
    eventCursor: z.number().int().nonnegative(),
  })
  .strict();
export type StartInvestigationResponse = z.infer<
  typeof StartInvestigationResponseSchema
>;

const isoDateTime = z.iso.datetime({ offset: true });

export const InvestigationClaimResponseSchema = z
  .object({
    id: z.uuid(),
    statement: z.string(),
    preservedQualifiers: z.array(z.string()),
    approvedAt: isoDateTime.nullable(),
  })
  .strict();
export type InvestigationClaimResponse = z.infer<typeof InvestigationClaimResponseSchema>;

export const InvestigationRepositoryResponseSchema = z
  .object({
    owner: z.string(),
    name: z.string(),
    canonicalUrl: z.string().url(),
    requestedRef: z.string().nullable(),
  })
  .strict();

export const InvestigationResponseSchema = z
  .object({
    id: InvestigationIdSchema,
    status: BackendLifecycleStatusSchema,
    repository: InvestigationRepositoryResponseSchema,
    version: z.number().int().nonnegative(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    startedAt: isoDateTime.nullable(),
    completedAt: isoDateTime.nullable(),
    failureCode: z.string().nullable(),
    claim: InvestigationClaimResponseSchema,
  })
  .strict();
export type InvestigationResponse = z.infer<typeof InvestigationResponseSchema>;

export const InvestigationSummarySchema = z
  .object({
    id: InvestigationIdSchema,
    status: BackendLifecycleStatusSchema,
    repository: InvestigationRepositoryResponseSchema,
    claimStatement: z.string(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    startedAt: isoDateTime.nullable(),
    completedAt: isoDateTime.nullable(),
    hasReport: z.boolean(),
  })
  .strict();
export type InvestigationSummary = z.infer<typeof InvestigationSummarySchema>;

export const InvestigationListResponseSchema = z
  .object({
    investigations: z.array(InvestigationSummarySchema).max(50),
  })
  .strict();
export type InvestigationListResponse = z.infer<typeof InvestigationListResponseSchema>;

export const InvestigationEventResponseSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: z.string().min(1).max(64),
    stage: BackendLifecycleStatusSchema,
    publicPayload: z.unknown(),
    createdAt: isoDateTime,
  })
  .strict();
export type InvestigationEventResponse = z.infer<typeof InvestigationEventResponseSchema>;

export const InvestigationEventsResponseSchema = z
  .object({
    events: z.array(InvestigationEventResponseSchema).max(50),
    nextCursor: z.number().int().nonnegative(),
  })
  .strict();
export type InvestigationEventsResponse = z.infer<typeof InvestigationEventsResponseSchema>;

export const InvestigationReportResponseSchema = z
  .object({
    investigationId: InvestigationIdSchema,
    completionDisposition: z.enum(["completed", "completed_with_limitations"]),
    artifactHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
    artifact: z.unknown(),
  })
  .strict();
export type InvestigationReportResponse = z.infer<typeof InvestigationReportResponseSchema>;

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const PublicErrorCodeSchema = z.enum([
  "malformed_input",
  "invalid_repository_url",
  "invalid_claim",
  "invalid_idempotency_key",
  "invalid_lifecycle_transition",
  "not_found",
  "conflict",
  "rate_limited",
  "dependency_unavailable",
  "internal_error",
]);
export type PublicErrorCode = z.infer<typeof PublicErrorCodeSchema>;

type PublicErrorDefinition = Readonly<{
  httpStatus: number;
  publicMessage: string;
}>;

export const PUBLIC_ERROR_DEFINITIONS = Object.freeze({
  malformed_input: Object.freeze({ httpStatus: 400, publicMessage: "The request is malformed." }),
  invalid_repository_url: Object.freeze({ httpStatus: 422, publicMessage: "Enter a valid GitHub repository URL." }),
  invalid_claim: Object.freeze({ httpStatus: 422, publicMessage: "The claim is invalid." }),
  invalid_idempotency_key: Object.freeze({ httpStatus: 422, publicMessage: "Enter a valid idempotency key." }),
  invalid_lifecycle_transition: Object.freeze({ httpStatus: 409, publicMessage: "The requested lifecycle transition is not allowed." }),
  not_found: Object.freeze({ httpStatus: 404, publicMessage: "The requested resource was not found." }),
  conflict: Object.freeze({ httpStatus: 409, publicMessage: "The request conflicts with the current resource state." }),
  rate_limited: Object.freeze({ httpStatus: 429, publicMessage: "Too many requests. Try again later." }),
  dependency_unavailable: Object.freeze({ httpStatus: 503, publicMessage: "A required service is temporarily unavailable." }),
  internal_error: Object.freeze({ httpStatus: 500, publicMessage: "An unexpected error occurred." }),
} as const satisfies Readonly<Record<PublicErrorCode, PublicErrorDefinition>>);

export const PUBLIC_VALIDATION_ISSUE_MESSAGES = Object.freeze({
  invalid_type: "Enter a value of the expected type.",
  too_small: "Enter a value that meets the minimum requirement.",
  too_big: "Enter a value that meets the maximum requirement.",
  invalid_format: "Enter a value in the expected format.",
  invalid_value: "Enter one of the allowed values.",
  unknown_field: "Remove fields that are not supported.",
  invalid_input: "Enter a valid value.",
} as const);

export const PublicValidationIssueCodeSchema = z.enum([
  "invalid_type",
  "too_small",
  "too_big",
  "invalid_format",
  "invalid_value",
  "unknown_field",
  "invalid_input",
]);
export type PublicValidationIssueCode = z.infer<
  typeof PublicValidationIssueCodeSchema
>;

const PUBLIC_FIELD_PATH = /^[A-Za-z][A-Za-z0-9_]{0,63}(?:\.(?:[A-Za-z][A-Za-z0-9_]{0,63}|\d{1,4})){0,7}$/;

export const PublicValidationIssueSchema = z
  .object({
    field: z.string().min(1).max(255).regex(PUBLIC_FIELD_PATH),
    code: PublicValidationIssueCodeSchema,
    message: z.string().min(1).max(100),
  })
  .strict()
  .superRefine((issue, context) => {
    if (issue.message !== PUBLIC_VALIDATION_ISSUE_MESSAGES[issue.code]) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "Validation issue messages must match their public code.",
      });
    }
  });
export type PublicValidationIssue = z.infer<typeof PublicValidationIssueSchema>;

export const PublicSafeErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: PublicErrorCodeSchema,
        message: z.string().min(1),
        issues: z.array(PublicValidationIssueSchema).max(50).optional(),
      })
      .strict()
      .superRefine((error, context) => {
        if (error.message !== PUBLIC_ERROR_DEFINITIONS[error.code].publicMessage) {
          context.addIssue({
            code: "custom",
            path: ["message"],
            message: "Public error messages must match their public code.",
          });
        }
      }),
  })
  .strict();
export type PublicSafeErrorEnvelope = z.infer<
  typeof PublicSafeErrorEnvelopeSchema
>;
