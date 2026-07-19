import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely, type Transaction } from "kysely";
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
async function expectSqlRejection(action: (tx: Transaction<Database>) => Promise<unknown>) {
  await expect(db.transaction().execute(async (tx) => action(tx))).rejects.toBeTruthy();
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

  it("matches the complete authoritative catalog contract", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string;
      is_nullable: string; column_default: string; is_identity: string }>`
      select table_name, column_name, data_type, is_nullable,
        coalesce(column_default, '') column_default, is_identity
      from information_schema.columns where table_schema = 'public'
        and table_name in ('investigations','manual_claims','investigation_events','idempotency_records','investigation_jobs')
      order by table_name, ordinal_position
    `.execute(db);
    const actual = Object.fromEntries(columns.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      `${row.data_type}|${row.is_nullable}|${row.column_default}|${row.is_identity}`,
    ]));
    expect(actual).toEqual({
      "idempotency_records.scope": "text|NO||NO",
      "idempotency_records.idempotency_key": "uuid|NO||NO",
      "idempotency_records.request_hash_sha256": "text|NO||NO",
      "idempotency_records.investigation_id": "uuid|NO||NO",
      "idempotency_records.result_kind": "text|NO||NO",
      "idempotency_records.created_at": "timestamp with time zone|NO||NO",
      "investigation_events.sequence": "bigint|NO||YES",
      "investigation_events.investigation_id": "uuid|NO||NO",
      "investigation_events.type": "text|NO||NO",
      "investigation_events.stage": "text|NO||NO",
      "investigation_events.public_payload": "jsonb|NO|'{}'::jsonb|NO",
      "investigation_events.created_at": "timestamp with time zone|NO||NO",
      "investigation_jobs.id": "uuid|NO||NO",
      "investigation_jobs.investigation_id": "uuid|NO||NO",
      "investigation_jobs.kind": "text|NO||NO",
      "investigation_jobs.status": "text|NO||NO",
      "investigation_jobs.attempt": "integer|NO|0|NO",
      "investigation_jobs.available_at": "timestamp with time zone|NO||NO",
      "investigation_jobs.lease_owner": "text|YES||NO",
      "investigation_jobs.lease_expires_at": "timestamp with time zone|YES||NO",
      "investigation_jobs.created_at": "timestamp with time zone|NO||NO",
      "investigation_jobs.updated_at": "timestamp with time zone|NO||NO",
      "investigations.id": "uuid|NO||NO",
      "investigations.status": "text|NO||NO",
      "investigations.repository_owner": "text|NO||NO",
      "investigations.repository_name": "text|NO||NO",
      "investigations.repository_canonical_url": "text|NO||NO",
      "investigations.requested_ref": "text|YES||NO",
      "investigations.version": "integer|NO|1|NO",
      "investigations.created_at": "timestamp with time zone|NO||NO",
      "investigations.updated_at": "timestamp with time zone|NO||NO",
      "investigations.started_at": "timestamp with time zone|YES||NO",
      "investigations.completed_at": "timestamp with time zone|YES||NO",
      "investigations.failure_code": "text|YES||NO",
      "manual_claims.id": "uuid|NO||NO",
      "manual_claims.investigation_id": "uuid|NO||NO",
      "manual_claims.statement": "text|NO||NO",
      "manual_claims.preserved_qualifiers": "jsonb|NO|'[]'::jsonb|NO",
      "manual_claims.approved_at": "timestamp with time zone|YES||NO",
      "manual_claims.created_at": "timestamp with time zone|NO||NO",
      "manual_claims.updated_at": "timestamp with time zone|NO||NO",
    });

    const constraints = await sql<{ relname: string; conname: string; contype: string; delete_action: string }>`
      select c.relname, con.conname, con.contype,
        case con.confdeltype when 'c' then 'CASCADE' when 'a' then 'NO ACTION' else con.confdeltype::text end delete_action
      from pg_constraint con join pg_class c on c.oid = con.conrelid
      where c.relname in ('investigations','manual_claims','investigation_events','idempotency_records','investigation_jobs')
      order by c.relname, con.conname
    `.execute(db);
    const checkNames = constraints.rows.filter((row) => row.contype === "c").map((row) => row.conname).sort();
    expect(checkNames).toEqual([
      "idempotency_records_request_hash_sha256_check", "idempotency_records_result_kind_check",
      "idempotency_records_scope_check", "idempotency_records_scope_result_check",
      "investigation_events_public_payload_check", "investigation_events_stage_check", "investigation_events_type_check",
      "investigation_jobs_attempt_check", "investigation_jobs_kind_check", "investigation_jobs_queued_lease_check",
      "investigation_jobs_status_check", "investigations_completion_coherence_check",
      "investigations_failure_code_check", "investigations_failure_coherence_check",
      "investigations_repository_canonical_url_check", "investigations_repository_name_check",
      "investigations_repository_owner_check", "investigations_requested_ref_check",
      "investigations_started_coherence_check", "investigations_status_check", "investigations_version_check",
      "manual_claims_preserved_qualifiers_check", "manual_claims_statement_check",
    ].sort());
    expect(constraints.rows.filter((row) => row.contype === "f").map((row) => [row.relname, row.delete_action])).toEqual([
      ["idempotency_records", "CASCADE"], ["investigation_events", "CASCADE"],
      ["investigation_jobs", "CASCADE"], ["manual_claims", "CASCADE"],
    ]);
    expect(constraints.rows.filter((row) => row.contype === "p").map((row) => row.relname).sort()).toEqual([
      "idempotency_records", "investigation_events", "investigation_jobs", "investigations", "manual_claims",
    ]);
    expect(constraints.rows.filter((row) => row.contype === "u").map((row) => row.conname)).toEqual([
      "manual_claims_investigation_id_key",
    ]);
    const indexes = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where schemaname='public'
        and indexname in ('investigation_events_cursor_idx','investigation_jobs_initial_snapshot_idx')
      order by indexname
    `.execute(db);
    expect(indexes.rows[0]).toMatchObject({ indexname: "investigation_events_cursor_idx" });
    expect(indexes.rows[0].indexdef).toContain("(investigation_id, sequence)");
    expect(indexes.rows[1]).toMatchObject({ indexname: "investigation_jobs_initial_snapshot_idx" });
    expect(indexes.rows[1].indexdef).toContain("WHERE ((kind = 'repository_snapshot'::text) AND (status = 'queued'::text))");
  });

  it("rejects every bounded-field and lifecycle-coherence violation directly", async () => {
    const created = await repository.createInvestigation(createInput, randomUUID());
    for (const [column, value] of [
      ["repository_owner", ""], ["repository_owner", "o".repeat(40)],
      ["repository_name", ""], ["repository_name", "r".repeat(101)],
      ["repository_canonical_url", ""], ["repository_canonical_url", "u".repeat(2049)],
      ["requested_ref", ""], ["requested_ref", "x".repeat(256)],
    ] as const) {
      await expectSqlRejection((tx) => sql`update investigations set ${sql.ref(column)} = ${value} where id = ${created.id}`.execute(tx));
    }
    await expectSqlRejection((tx) => sql`update investigations set started_at=now() where id=${created.id}`.execute(tx));
    await expectSqlRejection((tx) => sql`update investigations set status='snapshotting', started_at=null where id=${created.id}`.execute(tx));
    await expectSqlRejection((tx) => sql`update investigations set status='completed', started_at=now(), completed_at=null where id=${created.id}`.execute(tx));
    await expectSqlRejection((tx) => sql`update investigations set completed_at=now() where id=${created.id}`.execute(tx));
    await expectSqlRejection((tx) => sql`update investigations set status='failed', failure_code=null where id=${created.id}`.execute(tx));
    await expectSqlRejection((tx) => sql`update investigations set status='failed', failure_code='stage_failed', completed_at=now() where id=${created.id}`.execute(tx));
    for (const failureCode of ["UPPER_CASE", "bad-code", `a${"x".repeat(64)}`]) {
      await expectSqlRejection((tx) => sql`update investigations set status='failed', failure_code=${failureCode} where id=${created.id}`.execute(tx));
    }
    await expectSqlRejection((tx) => sql`update manual_claims set preserved_qualifiers='{}'::jsonb where investigation_id=${created.id}`.execute(tx));
  });

  it("rejects incoherent idempotency, event, and duplicate-job rows directly", async () => {
    const approved = await createApproved();
    const now = new Date(), key = randomUUID(), hash = "a".repeat(64);
    await expectSqlRejection((tx) => sql`insert into idempotency_records(scope,idempotency_key,request_hash_sha256,investigation_id,result_kind,created_at)
      values ('create',${key},${hash},null,'investigation_created',${now})`.execute(tx));
    await expectSqlRejection((tx) => sql`insert into idempotency_records(scope,idempotency_key,request_hash_sha256,investigation_id,result_kind,created_at)
      values ('create',${randomUUID()},${hash},${approved.id},'investigation_started',${now})`.execute(tx));
    await expectSqlRejection((tx) => sql`insert into idempotency_records(scope,idempotency_key,request_hash_sha256,investigation_id,result_kind,created_at)
      values ('unknown',${randomUUID()},${hash},${approved.id},'investigation_created',${now})`.execute(tx));
    await expectSqlRejection((tx) => sql`insert into idempotency_records(scope,idempotency_key,request_hash_sha256,investigation_id,result_kind,created_at)
      values ('create',${randomUUID()},'short',${approved.id},'investigation_created',${now})`.execute(tx));
    await expectSqlRejection((tx) => sql`insert into investigation_events(investigation_id,type,stage,public_payload,created_at)
      values (${approved.id},'unknown_event','awaiting_claim_review','{}'::jsonb,${now})`.execute(tx));
    await repository.startInvestigation(approved.id, randomUUID());
    await expectSqlRejection((tx) => sql`insert into investigation_jobs(id,investigation_id,kind,status,available_at,lease_owner,lease_expires_at,created_at,updated_at)
      values (${randomUUID()},${approved.id},'repository_snapshot','queued',${now},null,null,${now},${now})`.execute(tx));
  });

  it("serializes concurrent claim edits with the last lock winner persisted", async () => {
    const approved = await createApproved();
    const [first, second] = await Promise.all([
      repository.approveClaim(approved.id, { ...approval, statement: "Concurrent edit A." }),
      repository.approveClaim(approved.id, { ...approval, statement: "Concurrent edit B." }),
    ]);
    const versions = [first.version, second.version].sort((a, b) => a - b);
    expect(versions).toEqual([approved.version + 1, approved.version + 2]);
    const lockWinner = first.version > second.version ? first : second;
    const persisted = await repository.getInvestigation(approved.id);
    expect(persisted.version).toBe(lockWinner.version);
    expect(persisted.claim.statement).toBe(lockWinner.claim.statement);
    const editedEvents = await db.selectFrom("investigation_events").select("sequence")
      .where("investigation_id", "=", approved.id).where("type", "=", "claim_edited").execute();
    expect(editedEvents).toHaveLength(2);
  });
});
