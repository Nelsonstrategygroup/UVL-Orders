-- Undo 20261114000200_weigh_sheets.sql: removes the weigh sheet tables
-- (sheets, weights, adjustments, photo records), their two functions, the
-- photo bucket's rules, and the Oct 1, 2026 starting setting if it was
-- never changed. Nothing else. Audit log rows stay, as a record.
--
-- Photos: Supabase doesn't allow deleting stored files with SQL. Before
-- running this, empty the "kill-sheets" bucket in the Supabase dashboard
-- (Storage), then delete the bucket there. The rules below are dropped
-- either way.
--
-- Run with: npx supabase db query --linked -f supabase/rollback/20261114000200_revert.sql

begin;
alter publication supabase_realtime drop table public.kill_sheet_photos, public.kill_adjustments, public.kill_lambs, public.kill_sheets;
drop table if exists public.kill_sheet_photos;
drop table if exists public.kill_adjustments;
drop table if exists public.kill_lambs;
drop table if exists public.kill_sheets;
drop function if exists public.use_setup_rates(uuid);
drop function if exists public.kill_sheets_set_rates();
drop function if exists public.lamb_cost_rates(uuid, date);
drop policy if exists "kill-sheets: read" on storage.objects;
drop policy if exists "kill-sheets: add" on storage.objects;
drop policy if exists "kill-sheets: delete" on storage.objects;
delete from public.lamb_cost_settings
where effective_from = '2026-10-01' and base_rate = 3.00 and live_factor = 2.02 and note = 'Starting rate (Lucas, 11/14/26)';
delete from supabase_migrations.schema_migrations where version = '20261114000200';
commit;
