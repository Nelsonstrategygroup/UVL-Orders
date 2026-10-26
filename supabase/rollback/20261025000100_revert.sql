-- Undo 20261025000100_le_trim_plan.sql: removes the Le Trim plans (every
-- week's saved plan is lost) and the two Le Trim settings.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261025000100_revert.sql

begin;

alter publication supabase_realtime drop table public.le_trim_plans;
drop table if exists public.le_trim_plans;
alter table public.app_settings drop column if exists le_trim_shoulder_trim_lb, drop column if exists le_trim_half_leg_trim_lb;

delete from supabase_migrations.schema_migrations where version = '20261025000100';

commit;
