-- Undo 20261023000200_box_label_numbers.sql: removes label numbers and the
-- print log (numbers given out and the record of what was printed are lost).
-- Run with: npx supabase db query --linked -f supabase/rollback/20261023000200_revert.sql

begin;

drop function if exists public.record_label_print(date, jsonb);
drop function if exists public.assign_box_labels(date, text[]);
drop table if exists public.label_prints;
drop table if exists public.box_labels;

delete from supabase_migrations.schema_migrations where version = '20261023000200';

commit;
