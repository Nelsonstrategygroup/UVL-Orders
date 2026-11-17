-- Undo 20261118000100_truck_runs.sql: removes the truck run log (drivers,
-- rates, runs, stops), the five truck categories and their rates, the two
-- category columns, the trucks area, and the closed-week guards on runs.
-- Files in the truck-files bucket are left; delete the bucket in the
-- Supabase dashboard if wanted. Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261118000100_revert.sql

begin;
alter publication supabase_realtime drop table public.truck_drivers, public.truck_driver_rates, public.truck_runs, public.truck_run_stops;
drop table if exists public.truck_run_stops;
drop table if exists public.truck_runs;
drop table if exists public.truck_driver_rates;
drop table if exists public.truck_drivers;
drop policy if exists "truck-files: read" on storage.objects;
drop policy if exists "truck-files: add" on storage.objects;
drop policy if exists "truck-files: delete" on storage.objects;

delete from public.expense_categories c
where c.name in ('Truck, driver pay', 'Truck, fuel', 'Truck, maintenance', 'Truck, payroll taxes: SAIF', 'Truck, payroll taxes: FICA')
  and not exists (select 1 from public.pnl_expenses e where e.category_id = c.id);
alter table public.expense_categories drop column truck_part, drop column delivery_kind;

delete from public.user_permissions where area = 'trucks';
delete from public.role_permissions where area = 'trucks';
create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup', 'invoices', 'prices'];
$$;
-- closed_week_guard() keeps its truck_run_stops line; with the table gone it never matches.
delete from supabase_migrations.schema_migrations where version = '20261118000100';
commit;
