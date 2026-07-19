import { sql, type Kysely, type Migration } from "kysely";

const LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001";

export const authOwnershipMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table users (
        id uuid primary key,
        github_id bigint not null unique,
        login text not null constraint users_login_check check (char_length(login) between 1 and 39),
        display_name text,
        avatar_url text constraint users_avatar_url_check check (avatar_url is null or char_length(avatar_url) between 1 and 2048),
        created_at timestamptz not null,
        updated_at timestamptz not null
      )
    `.execute(db);

    await sql`
      create table sessions (
        id uuid primary key,
        user_id uuid not null references users(id) on delete cascade,
        token_hash_sha256 text not null unique constraint sessions_token_hash_sha256_check check (token_hash_sha256 ~ '^[0-9a-f]{64}$'),
        expires_at timestamptz not null,
        created_at timestamptz not null
      )
    `.execute(db);
    await sql`create index sessions_user_id_idx on sessions(user_id)`.execute(db);
    await sql`create index sessions_expires_at_idx on sessions(expires_at)`.execute(db);

    await sql`
      create table security_events (
        id uuid primary key,
        user_id uuid references users(id) on delete set null,
        event_type text not null constraint security_events_event_type_check check (
          event_type in ('login_success', 'login_failure', 'logout', 'session_expired', 'rate_limited')
        ),
        metadata jsonb not null default '{}'::jsonb constraint security_events_metadata_check check (jsonb_typeof(metadata) = 'object'),
        created_at timestamptz not null
      )
    `.execute(db);
    await sql`create index security_events_user_id_created_at_idx on security_events(user_id, created_at desc)`.execute(db);

    await sql`
      insert into users (id, github_id, login, display_name, avatar_url, created_at, updated_at)
      values (${LEGACY_USER_ID}::uuid, 0, 'legacy', 'Legacy User', null, now(), now())
    `.execute(db);

    await sql`alter table investigations add column owner_user_id uuid references users(id)`.execute(db);
    await sql`update investigations set owner_user_id = ${LEGACY_USER_ID}::uuid where owner_user_id is null`.execute(db);
    await sql`alter table investigations alter column owner_user_id set not null`.execute(db);
    await sql`create index investigations_owner_user_id_updated_at_idx on investigations(owner_user_id, updated_at desc)`.execute(db);

    await sql`alter table idempotency_records add column owner_user_id uuid references users(id)`.execute(db);
    await sql`
      update idempotency_records ir
      set owner_user_id = i.owner_user_id
      from investigations i
      where ir.investigation_id = i.id and ir.owner_user_id is null
    `.execute(db);
    await sql`update idempotency_records set owner_user_id = ${LEGACY_USER_ID}::uuid where owner_user_id is null`.execute(db);
    await sql`alter table idempotency_records alter column owner_user_id set not null`.execute(db);
    await sql`alter table idempotency_records drop constraint idempotency_records_pkey`.execute(db);
    await sql`alter table idempotency_records add primary key (owner_user_id, scope, idempotency_key)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`alter table idempotency_records drop constraint idempotency_records_pkey`.execute(db);
    await sql`alter table idempotency_records add primary key (scope, idempotency_key)`.execute(db);
    await sql`alter table idempotency_records drop column owner_user_id`.execute(db);
    await sql`drop index if exists investigations_owner_user_id_updated_at_idx`.execute(db);
    await sql`alter table investigations drop column owner_user_id`.execute(db);
    await sql`drop table if exists security_events cascade`.execute(db);
    await sql`drop table if exists sessions cascade`.execute(db);
    await sql`drop table if exists users cascade`.execute(db);
  },
};
