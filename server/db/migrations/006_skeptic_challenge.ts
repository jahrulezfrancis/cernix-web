import { sql, type Kysely, type Migration } from "kysely";

export const skepticChallengeMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table investigations add column reinvestigation_cycle_count integer not null default 0
        constraint investigations_reinvestigation_cycle_check check (reinvestigation_cycle_count between 0 and 10);

      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning', 'investigation_evidence', 'investigation_skeptic'));

      create unique index investigation_jobs_active_skeptic_idx on investigation_jobs(investigation_id)
        where kind = 'investigation_skeptic' and status in ('queued','leased','retry_wait');

      create table skeptic_analyses (
        id uuid primary key,
        investigation_id uuid not null references investigations(id) on delete cascade,
        plan_id uuid not null references investigation_plans(id) on delete cascade,
        snapshot_id uuid not null references repository_snapshots(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        manifest_hash_sha256 char(64) not null,
        commit_sha char(40) not null,
        schema_version integer not null constraint skeptic_analyses_schema_check check (schema_version = 1),
        model_id text not null,
        prompt_version text not null constraint skeptic_analyses_prompt_check check (char_length(prompt_version) between 1 and 64),
        outcome text not null constraint skeptic_analyses_outcome_check check (outcome in ('cleared_for_judgment','reinvestigation_required')),
        reinvestigation_cycle integer not null constraint skeptic_analyses_cycle_check check (reinvestigation_cycle between 0 and 10),
        challenge_count integer not null constraint skeptic_analyses_challenge_count_check check (challenge_count between 0 and 30),
        canonical_artifact jsonb not null constraint skeptic_analyses_canonical_check check (jsonb_typeof(canonical_artifact) = 'object'),
        created_at timestamptz not null,
        constraint skeptic_analyses_investigation_cycle_unique unique(investigation_id, reinvestigation_cycle)
      );

      create table skeptic_challenges (
        id uuid primary key,
        analysis_id uuid not null references skeptic_analyses(id) on delete cascade,
        investigation_id uuid not null references investigations(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        challenge_key text not null constraint skeptic_challenges_key_check check (char_length(challenge_key) between 1 and 64),
        challenge_type text not null,
        severity text not null constraint skeptic_challenges_severity_check check (severity in ('critical','major','minor')),
        summary text not null constraint skeptic_challenges_summary_check check (char_length(summary) between 1 and 500),
        reasoning text not null constraint skeptic_challenges_reasoning_check check (char_length(reasoning) between 1 and 4000),
        evidence_refs jsonb not null constraint skeptic_challenges_refs_check check (jsonb_typeof(evidence_refs) = 'array'),
        related_candidate_keys jsonb not null constraint skeptic_challenges_related_check check (jsonb_typeof(related_candidate_keys) = 'array'),
        requested_reinvestigation boolean not null,
        created_at timestamptz not null,
        constraint skeptic_challenges_analysis_key_unique unique(analysis_id, challenge_key)
      );
      create index skeptic_challenges_investigation_idx on skeptic_challenges(investigation_id);

      create table challenge_resolutions (
        id uuid primary key,
        challenge_id uuid not null constraint challenge_resolutions_challenge_unique unique references skeptic_challenges(id) on delete cascade,
        disposition text not null constraint challenge_resolutions_disposition_check check (disposition in ('accepted','deferred_to_judge','triggers_reinvestigation')),
        resolution_note text not null constraint challenge_resolutions_note_check check (char_length(resolution_note) between 1 and 2000),
        created_at timestamptz not null
      );

      create table skeptic_job_attempts (
        id bigint generated always as identity primary key,
        job_id uuid not null,
        investigation_id uuid not null constraint skeptic_job_attempts_investigation_fk references investigations(id) on delete cascade,
        attempt_number integer not null constraint skeptic_job_attempts_number_check check (attempt_number between 1 and 10),
        lease_token uuid not null constraint skeptic_job_attempts_lease_token_unique unique,
        worker_owner text not null constraint skeptic_job_attempts_worker_owner_check check (char_length(worker_owner) between 1 and 128 and worker_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        status text not null constraint skeptic_job_attempts_status_check check (status in ('leased','succeeded','retry_scheduled','failed','lease_expired','cancelled')),
        started_at timestamptz not null,
        last_heartbeat_at timestamptz not null,
        finished_at timestamptz,
        failure_code text constraint skeptic_job_attempts_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        next_available_at timestamptz,
        constraint skeptic_job_attempts_job_fk foreign key(job_id, investigation_id) references investigation_jobs(id, investigation_id) on delete cascade,
        constraint skeptic_job_attempts_job_attempt_unique unique(job_id, attempt_number),
        constraint skeptic_job_attempts_timestamp_check check (last_heartbeat_at >= started_at and (finished_at is null or finished_at >= started_at) and (next_available_at is null or (finished_at is not null and next_available_at >= finished_at))),
        constraint skeptic_job_attempts_state_coherence_check check (
          (status = 'leased' and finished_at is null and failure_code is null and next_available_at is null) or
          (status = 'succeeded' and finished_at is not null and failure_code is null and next_available_at is null) or
          (status = 'retry_scheduled' and finished_at is not null and failure_code is not null and next_available_at is not null) or
          (status in ('failed','lease_expired','cancelled') and finished_at is not null and failure_code is not null and next_available_at is null)
        )
      );
      create index skeptic_job_attempts_job_idx on skeptic_job_attempts(job_id, attempt_number);

      drop trigger if exists evidence_task_runs_immutable on evidence_task_runs;
      drop function if exists prevent_evidence_task_run_mutation();
      create function prevent_evidence_task_run_mutation() returns trigger language plpgsql as $$
      begin
        if TG_OP = 'DELETE' then
          raise exception using errcode = '23514', message = 'evidence task run is immutable';
        end if;
        if old.status = 'queued' then
          if new.status not in ('succeeded', 'failed', 'skipped_deferred') then
            raise exception using errcode = '23514', message = 'evidence task run status transition invalid';
          end if;
        elsif old.status in ('succeeded', 'failed') and new.status = 'queued' and new.finished_at is null
            and new.failure_code is null and new.canonical_result is null then
          null;
        else
          raise exception using errcode = '23514', message = 'evidence task run is immutable';
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

      create function prevent_skeptic_analysis_mutation() returns trigger language plpgsql as $$
      begin
        raise exception using errcode = '23514', message = 'skeptic analysis is immutable';
      end $$;
      create trigger skeptic_analyses_immutable before update or delete on skeptic_analyses
        for each row execute function prevent_skeptic_analysis_mutation();

      create function prevent_skeptic_attempt_terminal_regression() returns trigger language plpgsql as $$
      begin
        if old.status <> 'leased' and new is distinct from old then
          raise exception using errcode = '23514', message = 'skeptic attempt terminal state is immutable';
        end if;
        return new;
      end $$;
      create trigger skeptic_job_attempts_terminal_state_guard before update of status on skeptic_job_attempts
        for each row execute function prevent_skeptic_attempt_terminal_regression();

      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted',
        'evidence_task_completed','skeptic_analysis_persisted','reinvestigation_started'
      ));
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted',
        'evidence_task_completed'
      ));

      drop trigger if exists skeptic_job_attempts_terminal_state_guard on skeptic_job_attempts;
      drop function if exists prevent_skeptic_attempt_terminal_regression();
      drop trigger if exists skeptic_analyses_immutable on skeptic_analyses;
      drop function if exists prevent_skeptic_analysis_mutation();

      drop trigger if exists evidence_task_runs_immutable on evidence_task_runs;
      drop function if exists prevent_evidence_task_run_mutation();
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

      drop table if exists skeptic_job_attempts;
      drop table if exists challenge_resolutions;
      drop table if exists skeptic_challenges;
      drop table if exists skeptic_analyses;

      delete from investigation_jobs where kind = 'investigation_skeptic';
      drop index if exists investigation_jobs_active_skeptic_idx;
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning', 'investigation_evidence'));

      alter table investigations drop column if exists reinvestigation_cycle_count;
    `.execute(db);
  },
};
