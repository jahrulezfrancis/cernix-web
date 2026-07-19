import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  IdempotencyKeySchema,
  IDEMPOTENCY_KEY_HEADER,
} from "@/lib/contracts/investigation-api";
import { ApplicationError, toPublicSafeError, toSafeValidationIssues } from "@/server/errors";

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

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new ApplicationError("malformed_input", { cause: error });
  }
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
