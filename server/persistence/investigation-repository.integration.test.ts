import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import type { Database } from "@/server/db/types";
import { createDisposableTestDatabase } from "@/server/db/test-database";
import { migrateToLatest, rollbackOne } from "@/server/db/migrate";
import { ApplicationError } from "@/server/errors";
import { InvestigationRepository } from "./investigation-repository";
import { BACKEND_LIFECYCLE_TRANSITIONS, type BackendLifecycleStatus } from "@/lib/contracts/investigation-api";

let harness: Awaited<ReturnType<typeof createDisposableTestDatabase>>;
let db: Kysely<Database>;
let repository: InvestigationRepository;
const createInput = {
  repositoryUrl: "https://github.com/Acme/Widget.git/",
  repositoryRef: " main ",
  claim: { statement: " The project verifies every pull request. " },
};
const approval = { statement: "The project verifies every pull request.", preservedQualifiers: ["every"], approved: true as const };

async function truncate() {
  await sql`truncate investigation_jobs, idempotency_records, investigation_events, manual_claims, investigations restart identity cascade`.execute(db);
}
async function createApproved() {
  const created = await repository.createInvestigation(createInput, randomUUID());
  return repository.approveClaim(created.id, approval);
}
async function counts() {
  const result: Record<string, number> = {};
  for (const table of ["investigations", "manual_claims", "investigation_events", "idempotency_records", "investigation_jobs"] as const) {
    result[table] = Number((await db.selectFrom(table).select(db.fn.countAll().as("count")).executeTakeFirstOrThrow()).count);
  }
  return result;
}

beforeAll(async () => {
  harness = await createDisposableTestDatabase();
  db = harness.db;
  repository = new InvestigationRepository(db);
  const first = await migrateToLatest(db);
  expect(first.some((result) => result.status === "Success")).toBe(true);
  await rollbackOne(db);
  const results = await migrateToLatest(db);
  expect(results.some((result) => result.status === "Success")).toBe(true);
});
beforeEach(truncate);
afterAll(async () => { await harness?.cleanup(); });

describe.sequential("PostgreSQL investigation persistence", () => {
  it("migrates the schema and enforces lifecycle, one-claim, and cascade constraints", async () => {
    const tables = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in
        ('investigations','manual_claims','investigation_events','idempotency_records','investigation_jobs')
    `.execute(db);
    expect(new Set(tables.rows.map((row) => row.table_name)).size).toBe(5);
    const indexes = await sql<{ indexname: string }>`
      select indexname from pg_indexes where schemaname = 'public'
        and indexname in ('investigation_events_cursor_idx','investigation_jobs_initial_snapshot_idx')
    `.execute(db);
    expect(new Set(indexes.rows.map((row) => row.indexname))).toEqual(new Set([
      "investigation_events_cursor_idx", "investigation_jobs_initial_snapshot_idx",
    ]));
    const created = await repository.createInvestigation(createInput, randomUUID());
    await expect(sql`update investigations set status = 'submitted' where id = ${created.id}`.execute(db)).rejects.toBeTruthy();
    await expect(db.insertInto("manual_claims").values({
      id: randomUUID(), investigation_id: created.id, statement: "second", preserved_qualifiers: "[]",
      approved_at: null, created_at: new Date(), updated_at: new Date(),
    }).execute()).rejects.toBeTruthy();
    await db.deleteFrom("investigations").where("id", "=", created.id).execute();
    expect(await counts()).toMatchObject({ investigations: 0, manual_claims: 0, investigation_events: 0 });
  });

  it("creates canonical state once and replays identical idempotent requests", async () => {
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      repository.createInvestigation(createInput, key),
      repository.createInvestigation(createInput, key),
    ]);
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ status: "awaiting_claim_review", repositoryOwner: "Acme",
      repositoryName: "Widget", repositoryCanonicalUrl: "https://github.com/Acme/Widget",
      requestedRef: "main", version: 1 });
    expect(await counts()).toMatchObject({ investigations: 1, manual_claims: 1, investigation_events: 1, idempotency_records: 1 });
    await expect(repository.createInvestigation({ ...createInput, claim: { statement: "different" } }, key))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects invalid create input before persistence", async () => {
    await expect(repository.createInvestigation({ ...createInput, repositoryUrl: "https://evil.test/x/y" }, randomUUID())).rejects.toBeTruthy();
    expect(await counts()).toMatchObject({ investigations: 0, manual_claims: 0 });
  });

  it("approves, idempotently replays, edits once, and rejects post-start edits", async () => {
    const created = await repository.createInvestigation(createInput, randomUUID());
    const approved = await repository.approveClaim(created.id, approval);
    const replay = await repository.approveClaim(created.id, approval);
    expect(replay.version).toBe(approved.version);
    expect(replay.claim.approvedAt?.getTime()).toBe(approved.claim.approvedAt?.getTime());
    const edited = await repository.approveClaim(created.id, { ...approval, statement: "An edited claim." });
    expect(edited.version).toBe(approved.version + 1);
    await repository.startInvestigation(created.id, randomUUID());
    await expect(repository.approveClaim(created.id, approval)).rejects.toMatchObject({ code: "invalid_lifecycle_transition" });
    await expect(repository.approveClaim(randomUUID(), approval)).rejects.toMatchObject({ code: "not_found" });
  });

  it("requires approval and starts exactly once under concurrency", async () => {
    const unapproved = await repository.createInvestigation(createInput, randomUUID());
    await expect(repository.startInvestigation(unapproved.id, randomUUID())).rejects.toMatchObject({ code: "conflict" });
    const approved = await repository.approveClaim(unapproved.id, approval);
    const keys = Array.from({ length: 8 }, () => randomUUID());
    const results = await Promise.all(keys.map((key) => repository.startInvestigation(approved.id, key)));
    expect(new Set(results.map((value) => value.startedAt?.getTime())).size).toBe(1);
    expect(results[0]).toMatchObject({ status: "snapshotting", version: approved.version + 1 });
    expect(await counts()).toMatchObject({ investigation_jobs: 1, investigation_events: 3, idempotency_records: 2 });
  });

  it("treats later starts as success but never restarts failed investigations", async () => {
    const approved = await createApproved();
    const started = await repository.startInvestigation(approved.id, randomUUID());
    const later = await repository.startInvestigation(started.id, randomUUID());
    expect(later.startedAt?.getTime()).toBe(started.startedAt?.getTime());
    expect(later.version).toBe(started.version);
    const failed = await repository.transitionInvestigation(started.id, "failed", { failureCode: "snapshot_timeout" });
    expect(failed.failureCode).toBe("snapshot_timeout");
    await expect(repository.startInvestigation(failed.id, randomUUID())).rejects.toMatchObject({ code: "invalid_lifecycle_transition" });
  });

  it("persists every authoritative forward edge and rejects stale expectations", async () => {
    for (const [from, targets] of Object.entries(BACKEND_LIFECYCLE_TRANSITIONS) as [BackendLifecycleStatus, readonly BackendLifecycleStatus[]][]) {
      for (const to of targets) {
        await truncate();
        const approved = await createApproved();
        await db.updateTable("investigations").set({
          status: from,
          started_at: from === "awaiting_claim_review" || from === "failed" ? null : new Date(),
        }).where("id", "=", approved.id).execute();
        const changed = await repository.transitionInvestigation(approved.id, to, {
          expectedStatus: from, ...(to === "failed" ? { failureCode: "stage_failed" } : {}),
        });
        expect(changed.status).toBe(to);
      }
    }
    await truncate();
    const approved = await createApproved();
    await expect(repository.transitionInvestigation(approved.id, "snapshotting", { expectedStatus: "planning" }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps same-state and completion timestamps immutable and rejects terminal regressions", async () => {
    const approved = await createApproved();
    let value = await repository.startInvestigation(approved.id, randomUUID());
    const same = await repository.transitionInvestigation(value.id, "snapshotting");
    expect(same.version).toBe(value.version);
    for (const status of ["planning", "investigating", "challenging", "judging", "completed"] as const) {
      value = await repository.transitionInvestigation(value.id, status);
    }
    const completedAt = value.completedAt?.getTime();
    const replay = await repository.transitionInvestigation(value.id, "completed");
    expect(replay.completedAt?.getTime()).toBe(completedAt);
    await expect(repository.transitionInvestigation(value.id, "investigating"))
      .rejects.toMatchObject({ code: "invalid_lifecycle_transition" });
  });

  it("paginates events strictly after precision-safe string cursors", async () => {
    const approved = await createApproved();
    await repository.startInvestigation(approved.id, randomUUID());
    await sql`select setval(pg_get_serial_sequence('investigation_events','sequence'), 9007199254740992, true)`.execute(db);
    await repository.transitionInvestigation(approved.id, "planning");
    const page = await repository.getEvents(approved.id, "0", 2);
    const next = await repository.getEvents(approved.id, page.nextCursor, 100);
    expect(page.events).toHaveLength(2);
    expect(next.events.every((event) => BigInt(event.sequence) > BigInt(page.nextCursor))).toBe(true);
    expect(next.nextCursor).toBe("9007199254740993");
    await expect(repository.getEvents(approved.id, "0", 101)).rejects.toMatchObject({ code: "malformed_input" });
  });

  it("rolls transactions back without partial state", async () => {
    const key = randomUUID();
    await db.schema.alterTable("manual_claims").addCheckConstraint("force_failure", sql`false`).execute();
    await expect(repository.createInvestigation(createInput, key)).rejects.toMatchObject({ code: "internal_error" });
    await db.schema.alterTable("manual_claims").dropConstraint("force_failure").execute();
    expect(await counts()).toMatchObject({ investigations: 0, manual_claims: 0, investigation_events: 0, idempotency_records: 0 });
  });
});
