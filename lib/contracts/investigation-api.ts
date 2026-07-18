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
    status: z.literal("snapshotting"),
    eventCursor: z.number().int().nonnegative(),
  })
  .strict();
export type StartInvestigationResponse = z.infer<
  typeof StartInvestigationResponseSchema
>;

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

export const PublicValidationIssueSchema = z
  .object({
    field: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type PublicValidationIssue = z.infer<typeof PublicValidationIssueSchema>;

export const PublicSafeErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: PublicErrorCodeSchema,
        message: z.string().min(1),
        issues: z.array(PublicValidationIssueSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type PublicSafeErrorEnvelope = z.infer<
  typeof PublicSafeErrorEnvelopeSchema
>;
