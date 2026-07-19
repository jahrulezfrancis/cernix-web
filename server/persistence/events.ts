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
  type: z.literal("investigation_started"), stage: z.literal("snapshotting"),
  payload: z.strictObject({ jobKind: z.literal("repository_snapshot") }),
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
  CreatedEventSchema, ClaimEventSchema, StartedEventSchema, LifecycleEventSchema,
]);
export type PublicInvestigationEvent = z.infer<typeof PublicInvestigationEventSchema>;
