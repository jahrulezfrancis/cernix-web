import { sql, type Kysely, type Migration } from "kysely";

export const initialMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table investigations (
        id uuid primary key,
        status text not null check (status in ('awaiting_claim_review','snapshotting','planning','investigating','challenging','reinvestigating','judging','completed','completed_with_limitations','failed')),
        repository_owner text not null, repository_name text not null,
        repository_canonical_url text not null, requested_ref text,
        version integer not null default 1 check (version > 0),
        created_at timestamptz not null, updated_at timestamptz not null,
        started_at timestamptz, completed_at timestamptz, failure_code text,
        check ((status in ('completed','completed_with_limitations')) = (completed_at is not null)),
        check ((status = 'failed') = (failure_code is not null))
      );
      create table manual_claims (
        id uuid primary key, investigation_id uuid not null unique references investigations(id) on delete cascade,
        statement text not null check (char_length(statement) between 1 and 4000),
        preserved_qualifiers jsonb not null default '[]'::jsonb check (jsonb_typeof(preserved_qualifiers) = 'array'),
        approved_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null
      );
      create table investigation_events (
        sequence bigint generated always as identity primary key,
        investigation_id uuid not null references investigations(id) on delete cascade,
        type text not null, stage text not null, public_payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null,
        check (stage in ('awaiting_claim_review','snapshotting','planning','investigating','challenging','reinvestigating','judging','completed','completed_with_limitations','failed')),
        check (jsonb_typeof(public_payload) = 'object')
      );
      create index investigation_events_cursor_idx on investigation_events(investigation_id, sequence);
      create table idempotency_records (
        scope text not null, idempotency_key uuid not null, request_hash_sha256 text not null check (request_hash_sha256 ~ '^[0-9a-f]{64}$'),
        investigation_id uuid references investigations(id), result_kind text not null, created_at timestamptz not null,
        primary key(scope, idempotency_key)
      );
      create table investigation_jobs (
        id uuid primary key, investigation_id uuid not null references investigations(id) on delete cascade,
        kind text not null check (kind = 'repository_snapshot'), status text not null check (status = 'queued'),
        attempt integer not null default 0 check (attempt >= 0), available_at timestamptz not null,
        lease_owner text, lease_expires_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null,
        check (status <> 'queued' or (lease_owner is null and lease_expires_at is null))
      );
      create unique index investigation_jobs_initial_snapshot_idx
        on investigation_jobs(investigation_id) where kind = 'repository_snapshot' and status = 'queued';
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table if exists investigation_jobs, idempotency_records, investigation_events, manual_claims, investigations cascade`.execute(db);
  },
};
