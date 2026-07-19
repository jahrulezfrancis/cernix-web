import { sql, type Kysely, type Migration } from "kysely";

export const snapshotWorkerMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      drop index investigation_jobs_initial_snapshot_idx;
      alter table investigation_jobs drop constraint investigation_jobs_status_check;
      alter table investigation_jobs drop constraint investigation_jobs_attempt_check;
      alter table investigation_jobs drop constraint if exists investigation_jobs_queued_lease_check;
      alter table investigation_jobs drop constraint if exists investigation_jobs_check;
      alter table investigation_jobs rename column attempt to attempt_count;
      alter table investigation_jobs
        add column max_attempts integer not null default 4,
        add column lease_token uuid,
        add column last_heartbeat_at timestamptz,
        add column started_at timestamptz,
        add column completed_at timestamptz,
        add column failed_at timestamptz,
        add column failure_code text;

      update investigation_jobs set attempt_count = 0, max_attempts = 4,
        available_at = greatest(available_at, created_at), updated_at = greatest(updated_at, created_at);

      alter table investigation_jobs
        add constraint investigation_jobs_status_check check (status in ('queued','leased','retry_wait','succeeded','failed','cancelled')),
        add constraint investigation_jobs_attempt_count_check check (attempt_count >= 0 and attempt_count <= max_attempts),
        add constraint investigation_jobs_max_attempts_check check (max_attempts between 1 and 10),
        add constraint investigation_jobs_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        add constraint investigation_jobs_lease_owner_check check (lease_owner is null or (char_length(lease_owner) between 1 and 128 and lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')),
        add constraint investigation_jobs_timestamp_check check (
          updated_at >= created_at and available_at >= created_at and
          (started_at is null or started_at >= created_at) and
          (completed_at is null or (started_at is not null and completed_at >= started_at) or (status = 'cancelled' and completed_at >= created_at)) and
          (failed_at is null or (started_at is not null and failed_at >= started_at)) and
          (last_heartbeat_at is null or (started_at is not null and last_heartbeat_at >= started_at)) and
          (lease_expires_at is null or (last_heartbeat_at is not null and lease_expires_at > last_heartbeat_at))
        ),
        add constraint investigation_jobs_state_coherence_check check (
          (status = 'queued' and attempt_count = 0 and lease_owner is null and lease_token is null and lease_expires_at is null and last_heartbeat_at is null and started_at is null and completed_at is null and failed_at is null and failure_code is null) or
          (status = 'leased' and attempt_count >= 1 and lease_owner is not null and lease_token is not null and lease_expires_at is not null and last_heartbeat_at is not null and started_at is not null and completed_at is null and failed_at is null and failure_code is null) or
          (status = 'retry_wait' and attempt_count >= 1 and lease_owner is null and lease_token is null and lease_expires_at is null and last_heartbeat_at is null and started_at is not null and completed_at is null and failed_at is null and failure_code is not null) or
          (status = 'succeeded' and lease_owner is null and lease_token is null and lease_expires_at is null and last_heartbeat_at is null and started_at is not null and completed_at is not null and failed_at is null and failure_code is null) or
          (status = 'failed' and attempt_count >= 1 and lease_owner is null and lease_token is null and lease_expires_at is null and last_heartbeat_at is null and started_at is not null and completed_at is null and failed_at is not null and failure_code is not null) or
          (status = 'cancelled' and lease_owner is null and lease_token is null and lease_expires_at is null and last_heartbeat_at is null and completed_at is not null and failed_at is null and failure_code is not null)
        ),
        add constraint investigation_jobs_id_investigation_unique unique(id, investigation_id);

      create unique index investigation_jobs_active_snapshot_idx on investigation_jobs(investigation_id)
        where kind = 'repository_snapshot' and status in ('queued','leased','retry_wait');
      create index investigation_jobs_claim_idx on investigation_jobs(available_at, created_at, id)
        where status in ('queued','retry_wait','leased');

      create table snapshot_job_attempts (
        id bigint generated always as identity primary key,
        job_id uuid not null,
        investigation_id uuid not null constraint snapshot_job_attempts_investigation_fk references investigations(id) on delete cascade,
        attempt_number integer not null constraint snapshot_job_attempts_number_check check (attempt_number between 1 and 10),
        lease_token uuid not null constraint snapshot_job_attempts_lease_token_unique unique,
        worker_owner text not null constraint snapshot_job_attempts_worker_owner_check check (char_length(worker_owner) between 1 and 128 and worker_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        status text not null constraint snapshot_job_attempts_status_check check (status in ('leased','succeeded','retry_scheduled','failed','lease_expired','cancelled')),
        started_at timestamptz not null,
        last_heartbeat_at timestamptz not null,
        finished_at timestamptz,
        failure_code text constraint snapshot_job_attempts_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        next_available_at timestamptz,
        constraint snapshot_job_attempts_job_fk foreign key(job_id, investigation_id) references investigation_jobs(id, investigation_id) on delete cascade,
        constraint snapshot_job_attempts_job_attempt_unique unique(job_id, attempt_number),
        constraint snapshot_job_attempts_timestamp_check check (last_heartbeat_at >= started_at and (finished_at is null or finished_at >= started_at) and (next_available_at is null or (finished_at is not null and next_available_at >= finished_at))),
        constraint snapshot_job_attempts_state_coherence_check check (
          (status = 'leased' and finished_at is null and failure_code is null and next_available_at is null) or
          (status = 'succeeded' and finished_at is not null and failure_code is null and next_available_at is null) or
          (status = 'retry_scheduled' and finished_at is not null and failure_code is not null and next_available_at is not null) or
          (status in ('failed','lease_expired','cancelled') and finished_at is not null and failure_code is not null and next_available_at is null)
        )
      );
      create index snapshot_job_attempts_job_idx on snapshot_job_attempts(job_id, attempt_number);

      create function prevent_snapshot_job_terminal_regression() returns trigger language plpgsql as $$
      begin
        if old.status in ('succeeded','failed','cancelled') and new is distinct from old then
          raise exception using errcode = '23514', message = 'snapshot job terminal state is immutable';
        end if;
        return new;
      end $$;
      create trigger investigation_jobs_terminal_state_guard before update of status on investigation_jobs
        for each row execute function prevent_snapshot_job_terminal_regression();

      create function prevent_snapshot_attempt_terminal_regression() returns trigger language plpgsql as $$
      begin
        if old.status <> 'leased' and new is distinct from old then
          raise exception using errcode = '23514', message = 'snapshot attempt terminal state is immutable';
        end if;
        return new;
      end $$;
      create trigger snapshot_job_attempts_terminal_state_guard before update of status on snapshot_job_attempts
        for each row execute function prevent_snapshot_attempt_terminal_regression();
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      drop table if exists snapshot_job_attempts;
      drop function if exists prevent_snapshot_attempt_terminal_regression();
      drop trigger if exists investigation_jobs_terminal_state_guard on investigation_jobs;
      drop function if exists prevent_snapshot_job_terminal_regression();
      drop index if exists investigation_jobs_claim_idx;
      drop index if exists investigation_jobs_active_snapshot_idx;
      delete from investigation_jobs where status in ('succeeded','failed','cancelled');
      update investigation_jobs set status = 'queued', attempt_count = 0, available_at = greatest(available_at, created_at),
        lease_owner = null, lease_token = null, lease_expires_at = null, last_heartbeat_at = null,
        started_at = null, completed_at = null, failed_at = null, failure_code = null,
        updated_at = greatest(updated_at, created_at);
      alter table investigation_jobs drop constraint investigation_jobs_id_investigation_unique;
      alter table investigation_jobs drop constraint investigation_jobs_state_coherence_check;
      alter table investigation_jobs drop constraint investigation_jobs_timestamp_check;
      alter table investigation_jobs drop constraint investigation_jobs_lease_owner_check;
      alter table investigation_jobs drop constraint investigation_jobs_failure_code_check;
      alter table investigation_jobs drop constraint investigation_jobs_max_attempts_check;
      alter table investigation_jobs drop constraint investigation_jobs_attempt_count_check;
      alter table investigation_jobs drop constraint investigation_jobs_status_check;
      alter table investigation_jobs drop column failure_code, drop column failed_at, drop column completed_at,
        drop column started_at, drop column last_heartbeat_at, drop column lease_token, drop column max_attempts;
      alter table investigation_jobs rename column attempt_count to attempt;
      alter table investigation_jobs
        add constraint investigation_jobs_status_check check (status = 'queued'),
        add constraint investigation_jobs_attempt_check check (attempt >= 0),
        add constraint investigation_jobs_queued_lease_check check (status <> 'queued' or (lease_owner is null and lease_expires_at is null));
      create unique index investigation_jobs_initial_snapshot_idx
        on investigation_jobs(investigation_id) where kind = 'repository_snapshot' and status = 'queued';
    `.execute(db);
  },
};
