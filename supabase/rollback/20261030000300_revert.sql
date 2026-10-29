-- Undo 20261030000300_le_trim_by_weight.sql: removes extra lambs and the two
-- Le Trim weight settings. Orders and the Le Trim plans are not touched.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261030000300_revert.sql

begin;
alter publication supabase_realtime drop table public.week_extra_lambs;
drop table if exists public.week_extra_lambs;
alter table public.app_settings
  drop column if exists le_trim_shoulder_lb,
  drop column if exists le_trim_leg_lb;
comment on column public.app_settings.le_trim_shoulder_trim_lb is null;
comment on column public.app_settings.le_trim_half_leg_trim_lb is null;
delete from supabase_migrations.schema_migrations where version = '20261030000300';
commit;
