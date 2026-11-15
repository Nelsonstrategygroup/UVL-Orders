-- Undo 20261115000200_drafts_on_packing.sql: packing no longer makes or
-- refreshes drafts; they're made when the week is opened on Invoices, as
-- before. Drafts already made stay (opening the week keeps them up to date).
-- Run with: npx supabase db query --linked -f supabase/rollback/20261115000200_revert.sql

begin;
drop trigger if exists packing_weights_drafts_ins on public.packing_weights;
drop trigger if exists packing_weights_drafts_upd on public.packing_weights;
drop trigger if exists packing_weights_drafts_del on public.packing_weights;
drop trigger if exists packing_lines_drafts_ins on public.packing_lines;
drop trigger if exists packing_lines_drafts_upd on public.packing_lines;
drop trigger if exists packing_lines_drafts_del on public.packing_lines;
drop function if exists public.packing_drafts();
drop function if exists public.draft_for_location(date, uuid);
delete from supabase_migrations.schema_migrations where version = '20261115000200';
commit;
