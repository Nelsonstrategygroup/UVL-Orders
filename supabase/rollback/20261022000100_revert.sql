-- Undo 20261022000100_delivery_day.sql: drops the delivery day column (and
-- every delivery day entered since). Nothing else used it.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261022000100_revert.sql

begin;

alter table public.customers drop column if exists delivery_day;

delete from supabase_migrations.schema_migrations where version = '20261022000100';

commit;
