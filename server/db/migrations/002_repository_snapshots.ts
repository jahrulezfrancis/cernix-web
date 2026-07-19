import { sql, type Kysely, type Migration } from "kysely";

export const repositorySnapshotsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      create table repository_snapshots (
        id uuid primary key,
        investigation_id uuid not null constraint repository_snapshots_investigation_fk references investigations(id) on delete cascade,
        github_repository_id bigint not null constraint repository_snapshots_github_id_check check (github_repository_id > 0),
        canonical_owner text not null constraint repository_snapshots_owner_check check (char_length(canonical_owner) between 1 and 39),
        canonical_repository text not null constraint repository_snapshots_repository_check check (char_length(canonical_repository) between 1 and 100),
        canonical_url text not null constraint repository_snapshots_url_check check (char_length(canonical_url) between 19 and 2048 and canonical_url like 'https://github.com/%/%'),
        default_branch text not null constraint repository_snapshots_default_branch_check check (char_length(default_branch) between 1 and 255),
        requested_ref text constraint repository_snapshots_requested_ref_check check (requested_ref is null or char_length(requested_ref) between 1 and 255),
        resolved_ref text not null constraint repository_snapshots_resolved_ref_check check (char_length(resolved_ref) between 1 and 255),
        commit_sha char(40) not null constraint repository_snapshots_commit_sha_check check (commit_sha ~ '^[0-9a-f]{40}$'),
        root_tree_sha char(40) not null constraint repository_snapshots_tree_sha_check check (root_tree_sha ~ '^[0-9a-f]{40}$'),
        manifest_schema_version integer not null constraint repository_snapshots_schema_version_check check (manifest_schema_version = 1),
        admission_policy_version integer not null constraint repository_snapshots_policy_version_check check (admission_policy_version = 1),
        manifest_hash_sha256 char(64) not null constraint repository_snapshots_manifest_hash_check check (manifest_hash_sha256 ~ '^[0-9a-f]{64}$'),
        inspected_entry_count integer not null constraint repository_snapshots_inspected_count_check check (inspected_entry_count between 0 and 50000),
        admitted_file_count integer not null constraint repository_snapshots_admitted_count_check check (admitted_file_count between 0 and 5000),
        excluded_entry_count integer not null constraint repository_snapshots_excluded_count_check check (excluded_entry_count between 0 and 50000),
        total_admitted_bytes bigint not null constraint repository_snapshots_total_bytes_check check (total_admitted_bytes between 0 and 52428800),
        created_at timestamptz not null,
        constraint repository_snapshots_count_coherence_check check (inspected_entry_count = admitted_file_count + excluded_entry_count and admitted_file_count <= inspected_entry_count),
        constraint repository_snapshots_investigation_unique unique(investigation_id)
      );
      create index repository_snapshots_identity_idx on repository_snapshots(github_repository_id, commit_sha);

      create table repository_snapshot_entries (
        id uuid primary key,
        snapshot_id uuid not null references repository_snapshots(id) on delete cascade,
        path text not null constraint repository_snapshot_entries_path_check check (char_length(path) between 1 and 1024 and path !~ '[[:cntrl:]]'),
        mode text not null constraint repository_snapshot_entries_mode_check check (mode in ('100644','100755','040000','120000','160000')),
        object_type text not null constraint repository_snapshot_entries_type_check check (object_type in ('blob','tree','commit')),
        object_sha char(40) not null constraint repository_snapshot_entries_sha_check check (object_sha ~ '^[0-9a-f]{40}$'),
        reported_size bigint constraint repository_snapshot_entries_size_check check (reported_size is null or reported_size between 0 and 9223372036854775807),
        decision text not null constraint repository_snapshot_entries_decision_check check (decision in ('admitted','excluded')),
        exclusion_reason text constraint repository_snapshot_entries_reason_check check (exclusion_reason is null or exclusion_reason in (
          'tree','submodule','symlink','malformed_git_entry','unsafe_path','generated_directory','dependency_directory','secret_path','unsupported_file_type','lockfile','minified_bundle','source_map','reported_file_too_large','file_count_limit','total_bytes_limit','file_too_large','binary_content','invalid_utf8','secret_detected','line_count_limit'
        )),
        manifest_order integer not null constraint repository_snapshot_entries_order_check check (manifest_order >= 0),
        constraint repository_snapshot_entries_path_unique unique(snapshot_id, path),
        constraint repository_snapshot_entries_order_unique unique(snapshot_id, manifest_order),
        constraint repository_snapshot_entries_owner_unique unique(id, snapshot_id, decision),
        constraint repository_snapshot_entries_decision_reason_check check ((decision = 'admitted' and exclusion_reason is null and mode in ('100644','100755') and object_type = 'blob') or (decision = 'excluded' and exclusion_reason is not null))
      );

      create table repository_snapshot_files (
        id uuid primary key,
        snapshot_id uuid not null references repository_snapshots(id) on delete cascade,
        entry_id uuid not null unique,
        entry_decision text not null constraint repository_snapshot_files_admitted_check check (entry_decision = 'admitted'),
        raw_content bytea not null,
        normalized_text text not null,
        raw_sha256 char(64) not null constraint repository_snapshot_files_raw_hash_check check (raw_sha256 ~ '^[0-9a-f]{64}$'),
        normalized_sha256 char(64) not null constraint repository_snapshot_files_normalized_hash_check check (normalized_sha256 ~ '^[0-9a-f]{64}$'),
        byte_count integer not null constraint repository_snapshot_files_byte_count_check check (byte_count between 0 and 1048576 and octet_length(raw_content) = byte_count),
        line_count integer not null constraint repository_snapshot_files_line_count_check check (line_count between 0 and 100000),
        detected_language text constraint repository_snapshot_files_language_check check (detected_language is null or char_length(detected_language) between 1 and 64),
        created_at timestamptz not null,
        constraint repository_snapshot_files_normalized_bytes_check check (octet_length(normalized_text) <= byte_count),
        constraint repository_snapshot_files_entry_fk foreign key(entry_id, snapshot_id, entry_decision) references repository_snapshot_entries(id, snapshot_id, decision) on delete cascade
      );
      create index repository_snapshot_files_snapshot_idx on repository_snapshot_files(snapshot_id);

      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in ('investigation_created','claim_approved','claim_edited','investigation_started','lifecycle_transitioned','repository_snapshot_persisted'));
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      delete from investigation_events where type = 'repository_snapshot_persisted';
      drop table if exists repository_snapshot_files, repository_snapshot_entries, repository_snapshots cascade;
      alter table investigation_events drop constraint investigation_events_type_check;
      alter table investigation_events add constraint investigation_events_type_check check (type in ('investigation_created','claim_approved','claim_edited','investigation_started','lifecycle_transitioned'));
    `.execute(db);
  },
};
