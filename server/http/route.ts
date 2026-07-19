import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  IdempotencyKeySchema,
  IDEMPOTENCY_KEY_HEADER,
} from "@/lib/contracts/investigation-api";
import type { SessionUser } from "@/server/auth/user-repository";
import { ApplicationError, toPublicSafeError, toSafeValidationIssues } from "@/server/errors";
import { getClientIp, requireSession } from "@/server/http/auth";
import { checkRateLimit } from "@/server/http/rate-limit";

export const MAX_JSON_BODY_BYTES = 256 * 1024;

export function jsonResponse<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function errorResponse(error: unknown): NextResponse {
  const { httpStatus, body } = toPublicSafeError(error);
  return NextResponse.json(body, { status: httpStatus });
}

export function parseIdempotencyKey(request: Request): string {
  const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (!raw) throw new ApplicationError("invalid_idempotency_key", {});
  return IdempotencyKeySchema.parse(raw.trim());
}

function assertRequestSize(request: Request): void {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return;
  const size = Number(contentLength);
  if (!Number.isFinite(size) || size > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("payload_too_large", {});
  }
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  assertRequestSize(request);
  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BODY_BYTES) throw new ApplicationError("payload_too_large", {});
    if (!text) return {};
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("malformed_input", { cause: error });
  }
}

export function enforceApiRateLimit(request: Request): void {
  const ip = getClientIp(request);
  checkRateLimit(`api:${ip}`, { limit: 120, windowMs: 60_000 });
}

export async function handleRoute<T>(action: () => Promise<T>): Promise<NextResponse> {
  try {
    return jsonResponse(await action());
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(new ApplicationError("malformed_input", { issues: toSafeValidationIssues(error) }));
    }
    return errorResponse(error);
  }
}

export async function handleAuthenticatedRoute<T>(
  request: Request,
  action: (session: SessionUser) => Promise<T>,
): Promise<NextResponse> {
  try {
    enforceApiRateLimit(request);
    const session = await requireSession(request);
    return jsonResponse(await action(session));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(new ApplicationError("malformed_input", { issues: toSafeValidationIssues(error) }));
    }
    return errorResponse(error);
  }
}
