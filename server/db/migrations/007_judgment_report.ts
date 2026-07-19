import { sql, type Kysely, type Migration } from "kysely";

export const judgmentReportMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning', 'investigation_evidence', 'investigation_skeptic', 'investigation_judge'));

      create unique index investigation_jobs_active_judge_idx on investigation_jobs(investigation_id)
        where kind = 'investigation_judge' and status in ('queued','leased','retry_wait');

      create table investigation_reports (
        id uuid primary key,
        investigation_id uuid not null constraint investigation_reports_investigation_unique unique references investigations(id) on delete cascade,
        plan_id uuid not null references investigation_plans(id) on delete cascade,
        snapshot_id uuid not null references repository_snapshots(id) on delete cascade,
        skeptic_analysis_id uuid not null references skeptic_analyses(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        manifest_hash_sha256 char(64) not null,
        commit_sha char(40) not null,
        schema_version integer not null constraint investigation_reports_schema_check check (schema_version = 1),
        model_id text not null,
        prompt_version text not null constraint investigation_reports_prompt_check check (char_length(prompt_version) between 1 and 64),
        completion_disposition text not null constraint investigation_reports_disposition_check check (completion_disposition in ('completed','completed_with_limitations')),
        report_summary text not null constraint investigation_reports_summary_check check (char_length(report_summary) between 1 and 2000),
        artifact_hash_sha256 char(64) not null,
        canonical_artifact jsonb not null constraint investigation_reports_canonical_check check (jsonb_typeof(canonical_artifact) = 'object'),
        judgment_count integer not null constraint investigation_reports_judgment_count_check check (judgment_count between 1 and 10),
        created_at timestamptz not null
      );

      create table claim_judgments (
        id uuid primary key,
        report_id uuid not null references investigation_reports(id) on delete cascade,
        investigation_id uuid not null references investigations(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        judgment_key text not null constraint claim_judgments_key_check check (char_length(judgment_key) between 1 and 64),
        verdict text not null constraint claim_judgments_verdict_check check (verdict in ('verified','partially_verified','unverified')),
        confidence text not null constraint claim_judgments_confidence_check check (confidence in ('high','moderate','low')),
        summary text not null constraint claim_judgments_summary_check check (char_length(summary) between 1 and 500),
        reasoning text not null constraint claim_judgments_reasoning_check check (char_length(reasoning) between 1 and 4000),
        confidence_factors jsonb not null constraint claim_judgments_factors_check check (jsonb_typeof(confidence_factors) = 'array'),
        unproven_aspects jsonb not null constraint claim_judgments_unproven_check check (jsonb_typeof(unproven_aspects) = 'array'),
        what_could_change_verdict jsonb not null constraint claim_judgments_change_check check (jsonb_typeof(what_could_change_verdict) = 'array'),
        created_at timestamptz not null,
        constraint claim_judgments_report_key_unique unique(report_id, judgment_key),
        constraint claim_judgments_report_claim_unique unique(report_id, claim_id)
      );
      create index claim_judgments_investigation_idx on claim_judgments(investigation_id);

      create table report_limitations (
        id uuid primary key,
        report_id uuid not null references investigation_reports(id) on delete cascade,
        investigation_id uuid not null references investigations(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        limitation_key text not null constraint report_limitations_key_check check (char_length(limitation_key) between 1 and 64),
        description text not null constraint report_limitations_description_check check (char_length(description) between 1 and 2000),
        impact text not null constraint report_limitations_impact_check check (impact in ('low','medium','high')),
        created_at timestamptz not null,
        constraint report_limitations_report_key_unique unique(report_id, limitation_key)
      );

      create table maintainer_actions (
        id uuid primary key,
        report_id uuid not null references investigation_reports(id) on delete cascade,
        investigation_id uuid not null references investigations(id) on delete cascade,
        claim_id uuid not null references manual_claims(id) on delete cascade,
        action_key text not null constraint maintainer_actions_key_check check (char_length(action_key) between 1 and 64),
        action_text text not null constraint maintainer_actions_text_check check (char_length(action_text) between 1 and 2000),
        priority text not null constraint maintainer_actions_priority_check check (priority in ('low','medium','high')),
        created_at timestamptz not null,
        constraint maintainer_actions_report_key_unique unique(report_id, action_key)
      );

      create table judge_job_attempts (
        id bigint generated always as identity primary key,
        job_id uuid not null,
        investigation_id uuid not null constraint judge_job_attempts_investigation_fk references investigations(id) on delete cascade,
        attempt_number integer not null constraint judge_job_attempts_number_check check (attempt_number between 1 and 10),
        lease_token uuid not null constraint judge_job_attempts_lease_token_unique unique,
        worker_owner text not null constraint judge_job_attempts_worker_owner_check check (char_length(worker_owner) between 1 and 128 and worker_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
        status text not null constraint judge_job_attempts_status_check check (status in ('leased','succeeded','retry_scheduled','failed','lease_expired','cancelled')),
        started_at timestamptz not null,
        last_heartbeat_at timestamptz not null,
        finished_at timestamptz,
        failure_code text constraint judge_job_attempts_failure_code_check check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
        next_available_at timestamptz,
        constraint judge_job_attempts_job_fk foreign key(job_id, investigation_id) references investigation_jobs(id, investigation_id) on delete cascade,
        constraint judge_job_attempts_job_attempt_unique unique(job_id, attempt_number),
        constraint judge_job_attempts_timestamp_check check (last_heartbeat_at >= started_at and (finished_at is null or finished_at >= started_at) and (next_available_at is null or (finished_at is not null and next_available_at >= finished_at))),
        constraint judge_job_attempts_state_coherence_check check (
          (status = 'leased' and finished_at is null and failure_code is null and next_available_at is null) or
          (status = 'succeeded' and finished_at is not null and failure_code is null and next_available_at is null) or
          (status = 'retry_scheduled' and finished_at is not null and failure_code is not null and next_available_at is not null) or
          (status in ('failed','lease_expired','cancelled') and finished_at is not null and failure_code is not null and next_available_at is null)
        )
      );
      create index judge_job_attempts_job_idx on judge_job_attempts(job_id, attempt_number);

      create function prevent_investigation_report_mutation() returns trigger language plpgsql as $$
      begin
        raise exception using errcode = '23514', message = 'investigation report is immutable';
      end $$;
      create trigger investigation_reports_immutable before update or delete on investigation_reports
        for each row execute function prevent_investigation_report_mutation();

      create function prevent_judge_attempt_terminal_regression() returns trigger language plpgsql as $$
      begin
        if old.status <> 'leased' and new is distinct from old then
          raise exception using errcode = '23514', message = 'judge attempt terminal state is immutable';
        end if;
        return new;
      end $$;
      create trigger judge_job_attempts_terminal_state_guard before update of status on judge_job_attempts
        for each row execute function prevent_judge_attempt_terminal_regression();

      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted',
        'evidence_task_completed','skeptic_analysis_persisted','reinvestigation_started',
        'investigation_report_persisted'
      ));
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in (
        'investigation_created','claim_approved','claim_edited','investigation_started',
        'lifecycle_transitioned','repository_snapshot_persisted','investigation_plan_persisted',
        'evidence_task_completed','skeptic_analysis_persisted','reinvestigation_started'
      ));

      drop trigger if exists judge_job_attempts_terminal_state_guard on judge_job_attempts;
      drop function if exists prevent_judge_attempt_terminal_regression();
      drop trigger if exists investigation_reports_immutable on investigation_reports;
      drop function if exists prevent_investigation_report_mutation();

      drop table if exists judge_job_attempts;
      drop table if exists maintainer_actions;
      drop table if exists report_limitations;
      drop table if exists claim_judgments;
      drop table if exists investigation_reports;

      delete from investigation_jobs where kind = 'investigation_judge';
      drop index if exists investigation_jobs_active_judge_idx;
      alter table investigation_jobs drop constraint investigation_jobs_kind_check;
      alter table investigation_jobs add constraint investigation_jobs_kind_check
        check (kind in ('repository_snapshot', 'investigation_planning', 'investigation_evidence', 'investigation_skeptic'));
    `.execute(db);
  },
};
