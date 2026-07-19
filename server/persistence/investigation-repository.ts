import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import {
  ClaimApprovalRequestSchema, CreateInvestigationRequestSchema, IdempotencyKeySchema,
  InvestigationIdSchema, canTransitionBackendLifecycle, type BackendLifecycleStatus,
} from "@/lib/contracts/investigation-api";
import { ApplicationError } from "@/server/errors";
import { parseGitHubRepositoryRef } from "@/server/github/repository-ref";
import type { Database } from "@/server/db/types";
import { classifyDatabaseError } from "@/server/db/errors";
import { PublicInvestigationEventSchema, type PublicInvestigationEvent } from "./events";
import { boundEventLimit, hashCreateInput, hashStartInput, parseEventCursor, safeFailureCode } from "./helpers";
import { readSnapshotJobMaxAttempts } from "@/server/worker/worker-config";

type Db = Kysely<Database> | Transaction<Database>;
type Clock = () => Date;
export type InvestigationReadModel = {
  id: string; status: BackendLifecycleStatus; repositoryOwner: string; repositoryName: string;
  repositoryCanonicalUrl: string; requestedRef: string | null; version: number;
  createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null;
  failureCode: string | null; claim: { id: string; statement: string; preservedQualifiers: string[]; approvedAt: Date | null };
};

function domainError(error: unknown): never {
  throw classifyDatabaseError(error);
}
async function lockKey(tx: Transaction<Database>, value: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${value}, 0))`.execute(tx);
}
async function appendEvent(tx: Transaction<Database>, id: string, rawEvent: PublicInvestigationEvent, now: Date) {
  const { type, stage, payload } = PublicInvestigationEventSchema.parse(rawEvent);
  await tx.insertInto("investigation_events").values({
    investigation_id: id, type, stage, public_payload: JSON.stringify(payload), created_at: now,
  }).execute();
}
async function lockedInvestigation(tx: Transaction<Database>, id: string) {
  const row = await tx.selectFrom("investigations").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  if (!row) throw new ApplicationError("not_found", {});
  return row;
}
async function mapInvestigation(db: Db, id: string): Promise<InvestigationReadModel> {
  const row = await db.selectFrom("investigations").innerJoin("manual_claims", "manual_claims.investigation_id", "investigations.id")
    .select([
      "investigations.id", "investigations.status", "repository_owner", "repository_name",
      "repository_canonical_url", "requested_ref", "version", "investigations.created_at",
      "investigations.updated_at", "started_at", "completed_at", "failure_code",
      "manual_claims.id as claim_id", "statement", "preserved_qualifiers", "approved_at",
    ]).where("investigations.id", "=", id).executeTakeFirst();
  if (!row) throw new ApplicationError("not_found", {});
  return {
    id: row.id, status: row.status, repositoryOwner: row.repository_owner,
    repositoryName: row.repository_name, repositoryCanonicalUrl: row.repository_canonical_url,
    requestedRef: row.requested_ref, version: row.version, createdAt: row.created_at,
    updatedAt: row.updated_at, startedAt: row.started_at, completedAt: row.completed_at,
    failureCode: row.failure_code, claim: { id: row.claim_id, statement: row.statement,
      preservedQualifiers: row.preserved_qualifiers, approvedAt: row.approved_at },
  };
}

export class InvestigationRepository {
  constructor(private readonly db: Kysely<Database>, private readonly clock: Clock = () => new Date(),
    private readonly snapshotJobMaxAttempts: number = readSnapshotJobMaxAttempts()) {
    if (!Number.isInteger(snapshotJobMaxAttempts) || snapshotJobMaxAttempts < 1 || snapshotJobMaxAttempts > 10) {
      throw new ApplicationError("malformed_input", {});
    }
  }

  async createInvestigation(raw: unknown, rawKey: unknown) {
    const input = CreateInvestigationRequestSchema.parse(raw);
    const key = IdempotencyKeySchema.parse(rawKey);
    const ref = parseGitHubRepositoryRef(input.repositoryUrl);
    const hash = hashCreateInput({ owner: ref.owner, repo: ref.repo, canonicalUrl: ref.canonicalUrl,
      requestedRef: input.repositoryRef, statement: input.claim.statement, qualifiers: [] });
    try {
      return await this.db.transaction().execute(async (tx) => {
        await lockKey(tx, `create:${key}`);
        const existing = await tx.selectFrom("idempotency_records").selectAll()
          .where("scope", "=", "create").where("idempotency_key", "=", key).executeTakeFirst();
        if (existing) {
          if (existing.request_hash_sha256 !== hash || !existing.investigation_id) throw new ApplicationError("conflict", {});
          return mapInvestigation(tx, existing.investigation_id);
        }
        const now = this.clock(), id = randomUUID();
        await tx.insertInto("investigations").values({
          id, status: "awaiting_claim_review", repository_owner: ref.owner, repository_name: ref.repo,
          repository_canonical_url: ref.canonicalUrl, requested_ref: input.repositoryRef ?? null,
          created_at: now, updated_at: now, started_at: null, completed_at: null, failure_code: null,
        }).execute();
        await tx.insertInto("manual_claims").values({
          id: randomUUID(), investigation_id: id, statement: input.claim.statement,
          preserved_qualifiers: "[]", approved_at: null, created_at: now, updated_at: now,
        }).execute();
        await appendEvent(tx, id, { type: "investigation_created", stage: "awaiting_claim_review", payload: { claimCount: 1 } }, now);
        await tx.insertInto("idempotency_records").values({
          scope: "create", idempotency_key: key, request_hash_sha256: hash,
          investigation_id: id, result_kind: "investigation_created", created_at: now,
        }).execute();
        return mapInvestigation(tx, id);
      });
    } catch (error) { return domainError(error); }
  }

  async approveClaim(idRaw: unknown, raw: unknown) {
    const id = InvestigationIdSchema.parse(idRaw), input = ClaimApprovalRequestSchema.parse(raw);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const investigation = await lockedInvestigation(tx, id);
        if (investigation.status !== "awaiting_claim_review") throw new ApplicationError("invalid_lifecycle_transition", {});
        const claim = await tx.selectFrom("manual_claims").selectAll().where("investigation_id", "=", id).executeTakeFirstOrThrow();
        const identical = claim.statement === input.statement &&
          JSON.stringify(claim.preserved_qualifiers) === JSON.stringify(input.preservedQualifiers) && claim.approved_at !== null;
        if (identical) return mapInvestigation(tx, id);
        const now = this.clock();
        await tx.updateTable("manual_claims").set({
          statement: input.statement, preserved_qualifiers: JSON.stringify(input.preservedQualifiers),
          approved_at: now, updated_at: now,
        }).where("investigation_id", "=", id).execute();
        await tx.updateTable("investigations").set({ version: sql`version + 1`, updated_at: now }).where("id", "=", id).execute();
        await appendEvent(tx, id, {
          type: claim.approved_at ? "claim_edited" : "claim_approved",
          stage: "awaiting_claim_review", payload: { qualifierCount: input.preservedQualifiers.length },
        }, now);
        return mapInvestigation(tx, id);
      });
    } catch (error) { return domainError(error); }
  }

  async startInvestigation(idRaw: unknown, keyRaw: unknown) {
    const id = InvestigationIdSchema.parse(idRaw), key = IdempotencyKeySchema.parse(keyRaw);
    const scope = `start:${id}`, hash = hashStartInput(id);
    try {
      return await this.db.transaction().execute(async (tx) => {
        await lockKey(tx, `${scope}:${key}`);
        const record = await tx.selectFrom("idempotency_records").selectAll()
          .where("scope", "=", scope).where("idempotency_key", "=", key).executeTakeFirst();
        if (record) {
          if (record.request_hash_sha256 !== hash) throw new ApplicationError("conflict", {});
          return mapInvestigation(tx, id);
        }
        const investigation = await lockedInvestigation(tx, id);
        if (investigation.status === "failed") throw new ApplicationError("invalid_lifecycle_transition", {});
        if (investigation.status !== "awaiting_claim_review") return mapInvestigation(tx, id);
        if (investigation.status === "awaiting_claim_review") {
          const claim = await tx.selectFrom("manual_claims").select("approved_at").where("investigation_id", "=", id).executeTakeFirstOrThrow();
          if (!claim.approved_at) throw new ApplicationError("conflict", {});
          const now = this.clock();
          await tx.updateTable("investigations").set({
            status: "snapshotting", started_at: now, updated_at: now, version: sql`version + 1`,
          }).where("id", "=", id).execute();
          await tx.insertInto("investigation_jobs").values({
            id: randomUUID(), investigation_id: id, kind: "repository_snapshot", status: "queued",
            max_attempts: this.snapshotJobMaxAttempts,
            available_at: now, lease_owner: null, lease_token: null, lease_expires_at: null,
            last_heartbeat_at: null, started_at: null, completed_at: null, failed_at: null,
            failure_code: null, created_at: now, updated_at: now,
          }).execute();
          await appendEvent(tx, id, {
            type: "investigation_started", stage: "snapshotting", payload: { jobKind: "repository_snapshot" },
          }, now);
        }
        await tx.insertInto("idempotency_records").values({
          scope, idempotency_key: key, request_hash_sha256: hash, investigation_id: id,
          result_kind: "investigation_started", created_at: this.clock(),
        }).execute();
        return mapInvestigation(tx, id);
      });
    } catch (error) { return domainError(error); }
  }

  async transitionInvestigation(idRaw: unknown, to: BackendLifecycleStatus, options: {
    expectedStatus?: BackendLifecycleStatus; failureCode?: string;
  } = {}) {
    const id = InvestigationIdSchema.parse(idRaw);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const current = await lockedInvestigation(tx, id);
        if (options.expectedStatus && current.status !== options.expectedStatus) throw new ApplicationError("conflict", {});
        if (current.status === to) return mapInvestigation(tx, id);
        if (!canTransitionBackendLifecycle(current.status, to)) throw new ApplicationError("invalid_lifecycle_transition", {});
        const failureCode = safeFailureCode(options.failureCode);
        if (to === "failed" && !failureCode) throw new ApplicationError("malformed_input", {});
        if (to !== "failed" && failureCode) throw new ApplicationError("malformed_input", {});
        const now = this.clock(), completed = to === "completed" || to === "completed_with_limitations";
        await tx.updateTable("investigations").set({
          status: to, version: sql`version + 1`, updated_at: now,
          started_at: to === "failed" ? current.started_at : current.started_at ?? now,
          completed_at: completed ? now : current.completed_at, failure_code: to === "failed" ? failureCode : null,
        }).where("id", "=", id).execute();
        await appendEvent(tx, id, {
          type: "lifecycle_transitioned", stage: to, payload: { from: current.status, to },
        }, now);
        return mapInvestigation(tx, id);
      });
    } catch (error) { return domainError(error); }
  }

  async getInvestigation(idRaw: unknown) {
    const id = InvestigationIdSchema.parse(idRaw);
    try { return await mapInvestigation(this.db, id); } catch (error) { return domainError(error); }
  }

  async listInvestigations(limitRaw = 50) {
    const limit = Math.min(boundEventLimit(limitRaw), 50);
    try {
      const rows = await this.db.selectFrom("investigations")
        .innerJoin("manual_claims", "manual_claims.investigation_id", "investigations.id")
        .select([
          "investigations.id", "investigations.status", "repository_owner", "repository_name",
          "repository_canonical_url", "requested_ref", "version", "investigations.created_at",
          "investigations.updated_at", "started_at", "completed_at", "failure_code",
          "manual_claims.id as claim_id", "statement", "preserved_qualifiers", "approved_at",
        ])
        .orderBy("investigations.updated_at", "desc")
        .orderBy("investigations.id", "desc")
        .limit(limit)
        .execute();
      const reportIds = rows.length
        ? await this.db.selectFrom("investigation_reports").select("investigation_id")
          .where("investigation_id", "in", rows.map((row) => row.id)).execute()
        : [];
      const reports = new Set(reportIds.map((row) => row.investigation_id));
      return rows.map((row) => ({
        model: {
          id: row.id, status: row.status, repositoryOwner: row.repository_owner,
          repositoryName: row.repository_name, repositoryCanonicalUrl: row.repository_canonical_url,
          requestedRef: row.requested_ref, version: row.version, createdAt: row.created_at,
          updatedAt: row.updated_at, startedAt: row.started_at, completedAt: row.completed_at,
          failureCode: row.failure_code, claim: { id: row.claim_id, statement: row.statement,
            preservedQualifiers: row.preserved_qualifiers, approvedAt: row.approved_at },
        } satisfies InvestigationReadModel,
        hasReport: reports.has(row.id),
      }));
    } catch (error) { return domainError(error); }
  }

  async getEvents(idRaw: unknown, after?: string, limit = 50) {
    const id = InvestigationIdSchema.parse(idRaw), cursor = parseEventCursor(after), bounded = Math.min(boundEventLimit(limit), 50);
    await this.getInvestigation(id);
    try {
      const events = await this.db.selectFrom("investigation_events").selectAll()
        .where("investigation_id", "=", id).where("sequence", ">", cursor)
        .orderBy("sequence", "asc").limit(bounded).execute();
      return { events: events.map((event) => ({
        sequence: event.sequence, type: event.type, stage: event.stage,
        publicPayload: event.public_payload, createdAt: event.created_at,
      })), nextCursor: events.at(-1)?.sequence ?? cursor };
    } catch (error) { return domainError(error); }
  }
}
