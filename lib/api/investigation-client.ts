import {
  InvestigationEventsResponseSchema,
  InvestigationIdSchema,
  InvestigationListResponseSchema,
  InvestigationReportResponseSchema,
  InvestigationResponseSchema,
  StartInvestigationResponseSchema,
  type InvestigationResponse,
  type StartInvestigationResponse,
} from "@/lib/contracts/investigation-api";
import type { JudgeArtifact } from "@/lib/contracts/judgment-report";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, readonly envelope: { error: { code: string; message: string } }) {
    super(envelope.error.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = envelope.error.code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json() as { error?: { code: string; message: string } };
  if (!response.ok) {
    throw new ApiRequestError(response.status, body as { error: { code: string; message: string } });
  }
  return body as T;
}

export function isBackendInvestigationId(id: string): boolean {
  return InvestigationIdSchema.safeParse(id).success;
}

export async function listInvestigations() {
  return InvestigationListResponseSchema.parse(await request("/api/v1/investigations"));
}

export async function createInvestigation(input: unknown, idempotencyKey: string) {
  return InvestigationResponseSchema.parse(await request("/api/v1/investigations", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function getInvestigation(id: string) {
  return InvestigationResponseSchema.parse(await request(`/api/v1/investigations/${id}`));
}

export async function approveClaim(id: string, input: unknown) {
  return InvestigationResponseSchema.parse(await request(`/api/v1/investigations/${id}/claims`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }));
}

export async function startInvestigation(id: string, idempotencyKey: string) {
  return StartInvestigationResponseSchema.parse(await request(`/api/v1/investigations/${id}/start`, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({}),
  }));
}

export async function getInvestigationEvents(id: string, after?: number, limit?: number) {
  const params = new URLSearchParams();
  if (after !== undefined) params.set("after", String(after));
  if (limit !== undefined) params.set("limit", String(limit));
  const suffix = params.size ? `?${params.toString()}` : "";
  return InvestigationEventsResponseSchema.parse(await request(`/api/v1/investigations/${id}/events${suffix}`));
}

export async function getInvestigationReport(id: string) {
  return InvestigationReportResponseSchema.parse(await request(`/api/v1/investigations/${id}/report`));
}

export type { InvestigationResponse, JudgeArtifact, StartInvestigationResponse };
