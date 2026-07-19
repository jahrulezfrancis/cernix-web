import { sql, type Kysely, type Migration } from "kysely";

export const initialMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table investigations (
        id uuid primary key,
        status text not null check (status in ('awaiting_claim_review','snapshotting','planning','investigating','challenging','reinvestigating','judging','completed','completed_with_limitations','failed')),
        repository_owner text not null check (char_length(repository_owner) between 1 and 39),
        repository_name text not null check (char_length(repository_name) between 1 and 100),
        repository_canonical_url text not null check (char_length(repository_canonical_url) between 1 and 2048),
        requested_ref text check (requested_ref is null or char_length(requested_ref) between 1 and 255),
        version integer not null default 1 check (version > 0),
        created_at timestamptz not null, updated_at timestamptz not null,
        started_at timestamptz, completed_at timestamptz, failure_code text,
        check ((status in ('completed','completed_with_limitations')) = (completed_at is not null)),
        check ((status = 'failed') = (failure_code is not null)),
        check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        check ((status = 'awaiting_claim_review' and started_at is null) or
          status = 'failed' or
          (status not in ('awaiting_claim_review','failed') and started_at is not null))
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
        type text not null check (type in ('investigation_created','claim_approved','claim_edited','investigation_started','lifecycle_transitioned')),
        stage text not null, public_payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null,
        check (stage in ('awaiting_claim_review','snapshotting','planning','investigating','challenging','reinvestigating','judging','completed','completed_with_limitations','failed')),
        check (jsonb_typeof(public_payload) = 'object')
      );
      create index investigation_events_cursor_idx on investigation_events(investigation_id, sequence);
      create table idempotency_records (
        scope text not null check (scope = 'create' or scope ~ '^start:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
        idempotency_key uuid not null,
        request_hash_sha256 text not null check (request_hash_sha256 ~ '^[0-9a-f]{64}$'),
        investigation_id uuid not null references investigations(id) on delete cascade,
        result_kind text not null check (result_kind in ('investigation_created','investigation_started')),
        created_at timestamptz not null,
        primary key(scope, idempotency_key),
        check ((scope = 'create' and result_kind = 'investigation_created') or
          (scope like 'start:%' and result_kind = 'investigation_started'))
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
