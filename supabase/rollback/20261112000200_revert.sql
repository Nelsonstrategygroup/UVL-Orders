-- Undo 20261112000200_no_processing_week.sql: weeks can no longer be marked
-- "No processing this week" (any marks and their notes are dropped). Take the
-- app back to a version before 11/12/26 first: This week reads these columns.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261112000200_revert.sql

begin;
alter table public.weeks drop column if exists no_processing, drop column if exists no_processing_note;
delete from supabase_migrations.schema_migrations where version = '20261112000200';
commit;
