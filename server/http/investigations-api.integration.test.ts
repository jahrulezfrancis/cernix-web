import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { GET as listInvestigations, POST as createInvestigation } from "@/app/api/v1/investigations/route";
import { GET as getInvestigation } from "@/app/api/v1/investigations/[id]/route";
import { PATCH as approveClaim } from "@/app/api/v1/investigations/[id]/claims/route";
import { POST as startInvestigation } from "@/app/api/v1/investigations/[id]/start/route";
import { GET as getEvents } from "@/app/api/v1/investigations/[id]/events/route";
import { GET as getReport } from "@/app/api/v1/investigations/[id]/report/route";
import {
  InvestigationEventsResponseSchema,
  InvestigationListResponseSchema,
  InvestigationResponseSchema,
  PublicSafeErrorEnvelopeSchema,
  StartInvestigationResponseSchema,
} from "@/lib/contracts/investigation-api";
import type { Database } from "@/server/db/types";
import { createDisposableTestDatabase } from "@/server/db/test-database";
import { migrateToLatest } from "@/server/db/migrate";
import { setDatabaseFactoryForTests } from "@/server/db/database";

let harness: Awaited<ReturnType<typeof createDisposableTestDatabase>>;
let db: Kysely<Database>;

const createBody = {
  repositoryUrl: "https://github.com/Acme/Widget",
  repositoryRef: "main",
  claim: { statement: "The repository contains a README." },
};

async function truncate() {
  await sql`truncate investigation_reports, claim_judgments, report_limitations, maintainer_actions,
    investigation_jobs, idempotency_records, investigation_events, manual_claims, investigations restart identity cascade`.execute(db);
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function createInvestigationRequest(idempotencyKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return createInvestigation(new Request("http://localhost/api/v1/investigations", {
    method: "POST",
    headers,
    body: JSON.stringify(createBody),
  }));
}

async function approveInvestigation(id: string) {
  return approveClaim(new Request(`http://localhost/api/v1/investigations/${id}/claims`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      statement: "The repository contains a README.",
      preservedQualifiers: ["README"],
      approved: true,
    }),
  }), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  harness = await createDisposableTestDatabase();
  db = harness.db;
  setDatabaseFactoryForTests(() => ({ db, pool: harness.pool }));
  await migrateToLatest(db);
});
beforeEach(truncate);
afterAll(async () => {
  setDatabaseFactoryForTests();
  await harness?.cleanup();
});

describe.sequential("investigations HTTP API", () => {
  it("creates, lists, approves, starts, and streams events", async () => {
    const key = randomUUID();
    const created = await createInvestigationRequest(key);
    expect(created.status).toBe(200);
    const createdBody = InvestigationResponseSchema.parse(await readJson(created));
    expect(createdBody.status).toBe("awaiting_claim_review");

    const listed = await listInvestigations();
    expect(listed.status).toBe(200);
    const listBody = InvestigationListResponseSchema.parse(await readJson(listed));
    expect(listBody.investigations.some((item) => item.id === createdBody.id)).toBe(true);

    const fetched = await getInvestigation(new Request(`http://localhost/api/v1/investigations/${createdBody.id}`), {
      params: Promise.resolve({ id: createdBody.id }),
    });
    expect(fetched.status).toBe(200);

    const approved = await approveInvestigation(createdBody.id);
    expect(approved.status).toBe(200);

    const started = await startInvestigation(new Request(`http://localhost/api/v1/investigations/${createdBody.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
    }), { params: Promise.resolve({ id: createdBody.id }) });
    expect(started.status).toBe(200);
    const startedBody = StartInvestigationResponseSchema.parse(await readJson(started));
    expect(startedBody.investigationId).toBe(createdBody.id);
    expect(startedBody.status).toBe("snapshotting");
    expect(startedBody.eventCursor).toBeGreaterThan(0);

    const events = await getEvents(new Request(`http://localhost/api/v1/investigations/${createdBody.id}/events`), {
      params: Promise.resolve({ id: createdBody.id }),
    });
    expect(events.status).toBe(200);
    const eventsBody = InvestigationEventsResponseSchema.parse(await readJson(events));
    expect(eventsBody.events.length).toBeGreaterThan(0);

    const report = await getReport(new Request(`http://localhost/api/v1/investigations/${createdBody.id}/report`), {
      params: Promise.resolve({ id: createdBody.id }),
    });
    expect(report.status).toBe(404);
  });

  it("replays create and start requests with the same idempotency key", async () => {
    const createKey = randomUUID();
    const firstCreate = await createInvestigationRequest(createKey);
    const secondCreate = await createInvestigationRequest(createKey);
    expect(firstCreate.status).toBe(200);
    expect(secondCreate.status).toBe(200);
    const firstBody = InvestigationResponseSchema.parse(await readJson(firstCreate));
    const secondBody = InvestigationResponseSchema.parse(await readJson(secondCreate));
    expect(secondBody).toEqual(firstBody);

    const approved = await approveInvestigation(firstBody.id);
    expect(approved.status).toBe(200);

    const startKey = randomUUID();
    const firstStart = await startInvestigation(new Request(`http://localhost/api/v1/investigations/${firstBody.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": startKey },
    }), { params: Promise.resolve({ id: firstBody.id }) });
    const secondStart = await startInvestigation(new Request(`http://localhost/api/v1/investigations/${firstBody.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": startKey },
    }), { params: Promise.resolve({ id: firstBody.id }) });
    expect(firstStart.status).toBe(200);
    expect(secondStart.status).toBe(200);
    const firstStarted = StartInvestigationResponseSchema.parse(await readJson(firstStart));
    const secondStarted = StartInvestigationResponseSchema.parse(await readJson(secondStart));
    expect(secondStarted).toEqual(firstStarted);
  });

  it("rejects missing idempotency keys and invalid investigation identifiers", async () => {
    const missingKey = await createInvestigation(new Request("http://localhost/api/v1/investigations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody),
    }));
    expect(missingKey.status).toBe(422);
    expect(PublicSafeErrorEnvelopeSchema.parse(await readJson(missingKey)).error.code).toBe("invalid_idempotency_key");

    const invalidId = await getInvestigation(new Request("http://localhost/api/v1/investigations/not-a-uuid"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(invalidId.status).toBe(400);
    expect(PublicSafeErrorEnvelopeSchema.parse(await readJson(invalidId)).error.code).toBe("malformed_input");

    const missingId = randomUUID();
    const missingInvestigation = await getInvestigation(new Request(`http://localhost/api/v1/investigations/${missingId}`), {
      params: Promise.resolve({ id: missingId }),
    });
    expect(missingInvestigation.status).toBe(404);
    expect(PublicSafeErrorEnvelopeSchema.parse(await readJson(missingInvestigation)).error.code).toBe("not_found");
  });

  it("rejects starting an unapproved investigation", async () => {
    const created = await createInvestigationRequest(randomUUID());
    const createdBody = InvestigationResponseSchema.parse(await readJson(created));

    const started = await startInvestigation(new Request(`http://localhost/api/v1/investigations/${createdBody.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
    }), { params: Promise.resolve({ id: createdBody.id }) });
    expect(started.status).toBe(409);
    expect(PublicSafeErrorEnvelopeSchema.parse(await readJson(started)).error.code).toBe("conflict");
  });

  it("validates event pagination limits", async () => {
    const created = await createInvestigationRequest(randomUUID());
    const createdBody = InvestigationResponseSchema.parse(await readJson(created));

    const invalidLimit = await getEvents(
      new Request(`http://localhost/api/v1/investigations/${createdBody.id}/events?limit=101`),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    expect(invalidLimit.status).toBe(400);
    expect(PublicSafeErrorEnvelopeSchema.parse(await readJson(invalidLimit)).error.code).toBe("malformed_input");

    const zeroLimit = await getEvents(
      new Request(`http://localhost/api/v1/investigations/${createdBody.id}/events?limit=0`),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    expect(zeroLimit.status).toBe(400);

    const now = new Date();
    for (let index = 0; index < 55; index += 1) {
      await db.insertInto("investigation_events").values({
        investigation_id: createdBody.id,
        type: "lifecycle_transitioned",
        stage: "awaiting_claim_review",
        public_payload: JSON.stringify({ index }),
        created_at: now,
      }).execute();
    }

    const capped = await getEvents(
      new Request(`http://localhost/api/v1/investigations/${createdBody.id}/events?limit=75`),
      { params: Promise.resolve({ id: createdBody.id }) },
    );
    expect(capped.status).toBe(200);
    const cappedBody = InvestigationEventsResponseSchema.parse(await readJson(capped));
    expect(cappedBody.events).toHaveLength(50);
  });
});
