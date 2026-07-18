import { createHash } from "node:crypto";
import { ApplicationError } from "@/server/errors";

export function hashCreateInput(input: {
  owner: string; repo: string; canonicalUrl: string; requestedRef?: string; statement: string; qualifiers: readonly string[];
}) {
  return createHash("sha256").update(JSON.stringify([
    "create", input.owner, input.repo, input.canonicalUrl,
    input.requestedRef ?? null, input.statement, [...input.qualifiers],
  ])).digest("hex");
}
export function hashStartInput(investigationId: string) {
  return createHash("sha256").update(JSON.stringify(["start", investigationId])).digest("hex");
}
export function parseEventCursor(value: string | undefined): string {
  if (value === undefined) return "0";
  if (!/^(0|[1-9]\d{0,18})$/.test(value)) throw new ApplicationError("malformed_input", {});
  return value;
}
export function boundEventLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new ApplicationError("malformed_input", {});
  return value;
}
export function safeFailureCode(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new ApplicationError("malformed_input", {});
  return value;
}
