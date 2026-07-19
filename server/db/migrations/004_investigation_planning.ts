import { sql, type Kysely, type Migration } from "kysely";

export const investigationPlanningMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning'));

      create unique index investigation_jobs_active_planning_idx on investigation_jobs(investigation_id)
        where kind = 'investigation_planning' and status in ('queued','leased','retry_wait');

      create table investigation_plans (
        id uuid primary key,
        investigation_id uuid not null constraint investigation_plans_investigation_fk references investigations(id) on delete cascade,
        snapshot_id uuid not null constraint investigation_plans_snapshot_fk references repository_snapshots(id) on delete cascade,
        manifest_hash_sha256 char(64) not null constraint investigation_plans_manifest_hash_check check (manifest_hash_sha256 ~ '^[0-9a-f]{64}$'),
        commit_sha char(40) not null constraint investigation_plans_commit_sha_check check (commit_sha ~ '^[0-9a-f]{40}$'),
        schema_version integer not null constraint investigation_plans_schema_version_check check (schema_version = 1),
        model_id text not null constraint investigation_plans_model_id_check check (char_length(model_id) between 1 and 128 and model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        prompt_version text not null constraint investigation_plans_prompt_version_check check (char_length(prompt_version) between 1 and 64 and prompt_version ~ '^[a-z][a-z0-9_-]{0,63}$'),
        canonical_plan jsonb not null constraint investigation_plans_canonical_plan_check check (jsonb_typeof(canonical_plan) = 'object'),
        obligation_count integer not null constraint investigation_plans_obligation_count_check check (obligation_count between 1 and 100),
        task_count integer not null constraint investigation_plans_task_count_check check (task_count between 1 and 150),
        created_at timestamptz not null,
        constraint investigation_plans_investigation_unique unique(investigation_id)
      );

      create table verification_obligations (
        id uuid primary key,
        plan_id uuid not null references investigation_plans(id) on delete cascade,
        claim_id uuid not null constraint verification_obligations_claim_fk references manual_claims(id) on delete cascade,
        obligation_key text not null constraint verification_obligations_key_check check (char_length(obligation_key) between 1 and 64 and obligation_key ~ '^[a-z][a-z0-9_]{0,63}$'),
        description text not null constraint verification_obligations_description_check check (char_length(description) between 1 and 2000),
        taxonomy text constraint verification_obligations_taxonomy_check check (taxonomy is null or taxonomy in (
          'implementation_existence','behavioral','security_control','reliability_operational','testing_quality',
          'architecture_integration','reproducibility_provenance','dependency_supply_chain','documentation_governance','performance_scalability'
        )),
        priority integer not null constraint verification_obligations_priority_check check (priority between 1 and 20),
        constraint verification_obligations_plan_key_unique unique(plan_id, obligation_key)
      );
      create index verification_obligations_claim_idx on verification_obligations(claim_id);

      create table evidence_tasks (
        id uuid primary key,
        plan_id uuid not null references investigation_plans(id) on delete cascade,
        claim_id uuid not null constraint evidence_tasks_claim_fk references manual_claims(id) on delete cascade,
        task_key text not null constraint evidence_tasks_key_check check (char_length(task_key) between 1 and 64 and task_key ~ '^[a-z][a-z0-9_]{0,63}$'),
        specialist_capability text not null constraint evidence_tasks_capability_check check (specialist_capability in (
          'repository_investigator','security','testing','database_lifecycle','dependencies','architecture_documentation','reliability'
        )),
        expected_evidence_types jsonb not null constraint evidence_tasks_evidence_types_check check (jsonb_typeof(expected_evidence_types) = 'array'),
        query_terms jsonb not null default '[]'::jsonb constraint evidence_tasks_query_terms_check check (jsonb_typeof(query_terms) = 'array'),
        priority integer not null constraint evidence_tasks_priority_check check (priority between 1 and 30),
        depends_on_task_ids jsonb not null default '[]'::jsonb constraint evidence_tasks_dependencies_check check (jsonb_typeof(depends_on_task_ids) = 'array'),
        constraint evidence_tasks_plan_key_unique unique(plan_id, task_key)
      );
      create index evidence_tasks_claim_idx on evidence_tasks(claim_id);

      create table evidence_task_obligations (
        task_id uuid not null references evidence_tasks(id) on delete cascade,
        obligation_id uuid not null references verification_obligations(id) on delete cascade,
        primary key(task_id, obligation_id)
      );

      create table planning_job_attempts (
        id bigint generated always as identity primary key,
        job_id uuid not null,
        investigation_id uuid not null constraint planning_job_attempts_investigation_fk references investigations(id) on delete cascade,
        attempt_number integer not null constraint planning_job_attempts_number_check check (attempt_number between 1 and 10),
        lease_token uuid not null constraint planning_job_attempts_lease_token_unique unique,
        worker_owner text not null constraint planning_job_attempts_worker_owner_check check (char_length(worker_owner) between 1 and 128 and worker_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        status text not null constraint planning_job_attempts_status_check check (status in ('leased','succeeded','retry_scheduled','failed','lease_expired','cancelled')),
        started_at timestamptz not null,
        last_heartbeat_at timestamptz not null,
        finished_at timestamptz,
        failure_code text constraint planning_job_attempts_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        next_available_at timestamptz,
        constraint planning_job_attempts_job_fk foreign key(job_id, investigation_id) references investigation_jobs(id, investigation_id) on delete cascade,
        constraint planning_job_attempts_job_attempt_unique unique(job_id, attempt_number),
        constraint planning_job_attempts_timestamp_check check (last_heartbeat_at >= started_at and (finished_at is null or finished_at >= started_at) and (next_available_at is null or (finished_at is not null and next_available_at >= finished_at))),
        constraint planning_job_attempts_state_coherence_check check (
          (status = 'leased' and finished_at is null and failure_code is null and next_available_at is null) or
          (status = 'succeeded' and finished_at is not null and failure_code is null and next_available_at is null) or
          (status = 'retry_scheduled' and finished_at is not null and failure_code is not null and next_available_at is not null) or
          (status in ('failed','lease_expired','cancelled') and finished_at is not null and failure_code is not null and next_available_at is null)
        )
      );
      create index planning_job_attempts_job_idx on planning_job_attempts(job_id, attempt_number);

      create table model_invocations (
        id bigint generated always as identity primary key,
        plan_id uuid references investigation_plans(id) on delete set null,
        attempt_id bigint references planning_job_attempts(id) on delete set null,
        model_id text not null constraint model_invocations_model_id_check check (char_length(model_id) between 1 and 128 and model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        prompt_version text not null constraint model_invocations_prompt_version_check check (char_length(prompt_version) between 1 and 64 and prompt_version ~ '^[a-z][a-z0-9_-]{0,63}$'),
        input_token_estimate integer constraint model_invocations_input_tokens_check check (input_token_estimate is null or input_token_estimate between 0 and 1000000),
        output_token_estimate integer constraint model_invocations_output_tokens_check check (output_token_estimate is null or output_token_estimate between 0 and 1000000),
        status text not null constraint model_invocations_status_check check (status in ('succeeded','failed')),
        failure_code text constraint model_invocations_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        created_at timestamptz not null
      );

      create function prevent_investigation_plan_mutation() returns trigger language plpgsql as $$
      begin
        raise exception using errcode = '23514', message = 'investigation plan is immutable';
      end $$;
      create trigger investigation_plans_immutable before update or delete on investigation_plans
        for each row execute function prevent_investigation_plan_mutation();

      create function prevent_planning_attempt_terminal_regression() returns trigger language plpgsql as $$
      begin
        if old.status <> 'leased' and new is distinct from old then
          raise exception using errcode = '23514', message = 'planning attempt terminal state is immutable';
        end if;
        return new;
      end $$;
      create trigger planning_job_attempts_terminal_state_guard before update of status on planning_job_attempts
        for each row execute function prevent_planning_attempt_terminal_regression();

      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted'
      ));
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted'
      ));

      drop trigger if exists planning_job_attempts_terminal_state_guard on planning_job_attempts;
      drop function if exists prevent_planning_attempt_terminal_regression();
      drop trigger if exists investigation_plans_immutable on investigation_plans;
      drop function if exists prevent_investigation_plan_mutation();

      drop table if exists model_invocations;
      drop table if exists planning_job_attempts;
      drop table if exists evidence_task_obligations;
      drop table if exists evidence_tasks;
      drop table if exists verification_obligations;
      drop table if exists investigation_plans;

      delete from investigation_jobs where kind = 'investigation_planning';
      drop index if exists investigation_jobs_active_planning_idx;
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check check (kind = 'repository_snapshot');
    `.execute(db);
  },
};
