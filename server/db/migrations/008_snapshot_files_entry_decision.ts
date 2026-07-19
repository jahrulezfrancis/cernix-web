import { sql, type Kysely, type Migration } from "kysely";

export const snapshotFilesEntryDecisionMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table repository_snapshot_files drop constraint if exists repository_snapshot_files_entry_fk;

      alter table repository_snapshot_entries drop constraint if exists repository_snapshot_entries_id_snapshot_id_key;

      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where conname = 'repository_snapshot_entries_owner_unique'
        ) then
          alter table repository_snapshot_entries
            add constraint repository_snapshot_entries_owner_unique unique (id, snapshot_id, decision);
        end if;
      end $$;

      alter table repository_snapshot_files
        add column if not exists entry_decision text;

      update repository_snapshot_files
      set entry_decision = 'admitted'
      where entry_decision is null;

      alter table repository_snapshot_files
        alter column entry_decision set not null;

      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where conname = 'repository_snapshot_files_admitted_check'
        ) then
          alter table repository_snapshot_files
            add constraint repository_snapshot_files_admitted_check check (entry_decision = 'admitted');
        end if;
      end $$;

      alter table repository_snapshot_files
        add constraint repository_snapshot_files_entry_fk
        foreign key (entry_id, snapshot_id, entry_decision)
        references repository_snapshot_entries (id, snapshot_id, decision)
        on delete cascade;
    `.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`
      alter table repository_snapshot_files drop constraint if exists repository_snapshot_files_entry_fk;
      alter table repository_snapshot_files drop constraint if exists repository_snapshot_files_admitted_check;
      alter table repository_snapshot_files drop column if exists entry_decision;

      alter table repository_snapshot_entries drop constraint if exists repository_snapshot_entries_owner_unique;
      alter table repository_snapshot_entries
        add constraint repository_snapshot_entries_id_snapshot_id_key unique (id, snapshot_id);

      alter table repository_snapshot_files
        add constraint repository_snapshot_files_entry_fk
        foreign key (entry_id, snapshot_id)
        references repository_snapshot_entries (id, snapshot_id)
        on delete cascade;
    `.execute(db);
  },
};
