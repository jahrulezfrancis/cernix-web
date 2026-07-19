import { sql, type Kysely, type Migration } from "kysely";

export const evidenceCollectionMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning', 'investigation_evidence'));

      create unique index investigation_jobs_active_evidence_idx on investigation_jobs(investigation_id)
        where kind = 'investigation_evidence' and status in ('queued','leased','retry_wait');

      create table evidence_task_runs (
        id uuid primary key,
        task_id uuid not null constraint evidence_task_runs_task_unique unique references evidence_tasks(id) on delete cascade,
        plan_id uuid not null references investigation_plans(id) on delete cascade,
        investigation_id uuid not null constraint evidence_task_runs_investigation_fk references investigations(id) on delete cascade,
        claim_id uuid not null constraint evidence_task_runs_claim_fk references manual_claims(id) on delete cascade,
        task_key text not null constraint evidence_task_runs_key_check check (char_length(task_key) between 1 and 64),
        specialist_capability text not null,
        status text not null constraint evidence_task_runs_status_check check (status in ('queued','succeeded','failed','skipped_deferred')),
        failure_code text constraint evidence_task_runs_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        canonical_result jsonb constraint evidence_task_runs_canonical_check check (canonical_result is null or jsonb_typeof(canonical_result) = 'object'),
        created_at timestamptz not null,
        finished_at timestamptz,
        constraint evidence_task_runs_finished_check check (
          (status = 'queued' and finished_at is null and failure_code is null) or
          (status in ('succeeded','failed','skipped_deferred') and finished_at is not null)
        )
      );
      create index evidence_task_runs_investigation_idx on evidence_task_runs(investigation_id, status);

      create table evidence_candidates (
        id uuid primary key,
        run_id uuid not null references evidence_task_runs(id) on delete cascade,
        investigation_id uuid not null references investigations(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        snapshot_id uuid not null references repository_snapshots(id) on delete cascade,
        candidate_key text not null constraint evidence_candidates_key_check check (char_length(candidate_key) between 1 and 64),
        evidence_type text not null,
        observation text not null constraint evidence_candidates_observation_check check (char_length(observation) between 1 and 4000),
        strength text not null constraint evidence_candidates_strength_check check (strength in ('weak','moderate','strong')),
        manifest_hash_sha256 char(64) not null,
        commit_sha char(40) not null,
        created_at timestamptz not null,
        constraint evidence_candidates_run_key_unique unique(run_id, candidate_key)
      );

      create table evidence_excerpts (
        id uuid primary key,
        candidate_id uuid not null references evidence_candidates(id) on delete cascade,
        path text not null constraint evidence_excerpts_path_check check (char_length(path) between 1 and 512),
        line_start integer not null constraint evidence_excerpts_line_start_check check (line_start between 1 and 1000000),
        line_end integer not null constraint evidence_excerpts_line_end_check check (line_end between 1 and 1000000),
        normalized_sha256 char(64) not null,
        excerpt_text text not null constraint evidence_excerpts_text_check check (char_length(excerpt_text) between 1 and 8000),
        constraint evidence_excerpts_line_range_check check (line_end >= line_start)
      );

      create table evidence_gaps (
        id uuid primary key,
        run_id uuid not null references evidence_task_runs(id) on delete cascade,
        gap_key text not null constraint evidence_gaps_key_check check (char_length(gap_key) between 1 and 64),
        description text not null constraint evidence_gaps_description_check check (char_length(description) between 1 and 2000),
        impact text not null constraint evidence_gaps_impact_check check (impact in ('low','medium','high')),
        constraint evidence_gaps_run_key_unique unique(run_id, gap_key)
      );

      create table counterevidence_items (
        id uuid primary key,
        run_id uuid not null references evidence_task_runs(id) on delete cascade,
        counter_key text not null constraint counterevidence_key_check check (char_length(counter_key) between 1 and 64),
        related_candidate_key text constraint counterevidence_related_key_check check (related_candidate_key is null or char_length(related_candidate_key) between 1 and 64),
        description text not null constraint counterevidence_description_check check (char_length(description) between 1 and 2000),
        severity text not null constraint counterevidence_severity_check check (severity in ('minor','material','critical')),
        constraint counterevidence_run_key_unique unique(run_id, counter_key)
      );

      create table evidence_job_attempts (
        id bigint generated always as identity primary key,
        job_id uuid not null,
        investigation_id uuid not null constraint evidence_job_attempts_investigation_fk references investigations(id) on delete cascade,
        attempt_number integer not null constraint evidence_job_attempts_number_check check (attempt_number between 1 and 10),
        lease_token uuid not null constraint evidence_job_attempts_lease_token_unique unique,
        worker_owner text not null constraint evidence_job_attempts_worker_owner_check check (char_length(worker_owner) between 1 and 128 and worker_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        status text not null constraint evidence_job_attempts_status_check check (status in ('leased','succeeded','retry_scheduled','failed','lease_expired','cancelled')),
        started_at timestamptz not null,
        last_heartbeat_at timestamptz not null,
        finished_at timestamptz,
        failure_code text constraint evidence_job_attempts_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        next_available_at timestamptz,
        constraint evidence_job_attempts_job_fk foreign key(job_id, investigation_id) references investigation_jobs(id, investigation_id) on delete cascade,
        constraint evidence_job_attempts_job_attempt_unique unique(job_id, attempt_number),
        constraint evidence_job_attempts_timestamp_check check (last_heartbeat_at >= started_at and (finished_at is null or finished_at >= started_at) and (next_available_at is null or (finished_at is not null and next_available_at >= finished_at))),
        constraint evidence_job_attempts_state_coherence_check check (
          (status = 'leased' and finished_at is null and failure_code is null and next_available_at is null) or
          (status = 'succeeded' and finished_at is not null and failure_code is null and next_available_at is null) or
          (status = 'retry_scheduled' and finished_at is not null and failure_code is not null and next_available_at is not null) or
          (status in ('failed','lease_expired','cancelled') and finished_at is not null and failure_code is not null and next_available_at is null)
        )
      );
      create index evidence_job_attempts_job_idx on evidence_job_attempts(job_id, attempt_number);

      alter table model_invocations drop constraint if exists model_invocations_attempt_id_fkey;

      create function prevent_evidence_task_run_mutation() returns trigger language plpgsql as $$
      begin
        if TG_OP = 'DELETE' then
          raise exception using errcode = '23514', message = 'evidence task run is immutable';
        end if;
        if old.status <> 'queued' then
          raise exception using errcode = '23514', message = 'evidence task run is immutable';
        end if;
        if new.status not in ('succeeded', 'failed', 'skipped_deferred') then
          raise exception using errcode = '23514', message = 'evidence task run status transition invalid';
        end if;
        if new.task_id is distinct from old.task_id or new.plan_id is distinct from old.plan_id
           or new.investigation_id is distinct from old.investigation_id or new.claim_id is distinct from old.claim_id
           or new.task_key is distinct from old.task_key or new.specialist_capability is distinct from old.specialist_capability
           or new.created_at is distinct from old.created_at then
          raise exception using errcode = '23514', message = 'evidence task run core fields are immutable';
        end if;
        return new;
      end $$;
      create trigger evidence_task_runs_immutable before update or delete on evidence_task_runs
        for each row execute function prevent_evidence_task_run_mutation();

      create function prevent_evidence_attempt_terminal_regression() returns trigger language plpgsql as $$
      begin
        if old.status <> 'leased' and new is distinct from old then
          raise exception using errcode = '23514', message = 'evidence attempt terminal state is immutable';
        end if;
        return new;
      end $$;
      create trigger evidence_job_attempts_terminal_state_guard before update of status on evidence_job_attempts
        for each row execute function prevent_evidence_attempt_terminal_regression();

      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted',
        'evidence_task_completed'
      ));
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted'
      ));

      drop trigger if exists evidence_job_attempts_terminal_state_guard on evidence_job_attempts;
      drop function if exists prevent_evidence_attempt_terminal_regression();
      drop trigger if exists evidence_task_runs_immutable on evidence_task_runs;
      drop function if exists prevent_evidence_task_run_mutation();

      alter table model_invocations add constraint model_invocations_attempt_id_fkey
        foreign key(attempt_id) references planning_job_attempts(id) on delete set null;

      drop table if exists evidence_job_attempts;
      drop table if exists counterevidence_items;
      drop table if exists evidence_gaps;
      drop table if exists evidence_excerpts;
      drop table if exists evidence_candidates;
      drop table if exists evidence_task_runs;

      delete from investigation_jobs where kind = 'investigation_evidence';
      drop index if exists investigation_jobs_active_evidence_idx;
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning'));
    `.execute(db);
  },
};
