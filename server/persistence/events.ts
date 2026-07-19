import { z } from "zod";
import {
  BackendLifecycleStatusSchema, canTransitionBackendLifecycle,
} from "@/lib/contracts/investigation-api";

const awaiting = z.literal("awaiting_claim_review");
const CreatedEventSchema = z.strictObject({
  type: z.literal("investigation_created"), stage: awaiting,
  payload: z.strictObject({ claimCount: z.literal(1) }),
});
const ClaimEventSchema = z.strictObject({
  type: z.enum(["claim_approved", "claim_edited"]), stage: awaiting,
  payload: z.strictObject({ qualifierCount: z.number().int().min(0).max(20) }),
});
const StartedEventSchema = z.strictObject({
  type: z.literal("investigation_started"), stage: z.enum(["snapshotting", "planning"]),
  payload: z.strictObject({ jobKind: z.enum(["repository_snapshot", "investigation_planning"]) }),
});
const SnapshotPersistedEventSchema = z.strictObject({
  type: z.literal("repository_snapshot_persisted"), stage: z.literal("snapshotting"),
  payload: z.strictObject({
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
    inspectedEntryCount: z.number().int().min(0).max(50_000),
    admittedFileCount: z.number().int().min(0).max(5_000),
    excludedEntryCount: z.number().int().min(0).max(50_000),
    totalAdmittedBytes: z.string().regex(/^(?:0|[1-9]\d{0,8})$/),
  }),
});
const PlanPersistedEventSchema = z.strictObject({
  type: z.literal("investigation_plan_persisted"), stage: z.literal("planning"),
  payload: z.strictObject({
    planId: z.uuid(),
    obligationCount: z.number().int().min(1).max(100),
    taskCount: z.number().int().min(1).max(150),
    schemaVersion: z.literal(1),
    modelId: z.string().min(1).max(128),
    promptVersion: z.string().min(1).max(64),
  }),
});
const LifecycleEventSchema = z.strictObject({
  type: z.literal("lifecycle_transitioned"), stage: BackendLifecycleStatusSchema,
  payload: z.strictObject({ from: BackendLifecycleStatusSchema, to: BackendLifecycleStatusSchema }),
}).superRefine((event, context) => {
  if (event.stage !== event.payload.to || event.payload.from === event.payload.to ||
    !canTransitionBackendLifecycle(event.payload.from, event.payload.to)) {
    context.addIssue({ code: "custom", message: "Invalid public lifecycle event." });
  }
});

export const PublicInvestigationEventSchema = z.union([
  CreatedEventSchema, ClaimEventSchema, StartedEventSchema, SnapshotPersistedEventSchema,
  PlanPersistedEventSchema, LifecycleEventSchema,
]);
export type PublicInvestigationEvent = z.infer<typeof PublicInvestigationEventSchema>;
