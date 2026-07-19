import { z } from "zod";

export const SessionUserSchema = z.object({
  id: z.string().uuid(),
  login: z.string().min(1).max(39),
  displayName: z.string().min(1).max(255).nullable(),
  avatarUrl: z.string().url().nullable(),
}).strict();

export const SessionResponseSchema = z.object({
  authenticated: z.literal(true),
  user: SessionUserSchema,
}).strict();

export const UnauthenticatedSessionResponseSchema = z.object({
  authenticated: z.literal(false),
}).strict();

export type SessionUser = z.infer<typeof SessionUserSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
