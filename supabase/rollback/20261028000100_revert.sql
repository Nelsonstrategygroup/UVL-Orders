-- Undo 20261028000100_invoicing_foundation.sql: removes prices, invoice
-- settings, customer billing details, the week invoice numbers, the price
-- unit, the Billing role and the Invoices and Prices areas. Anyone set to
-- Billing goes back to Viewer first.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261028000100_revert.sql

begin;
alter publication supabase_realtime drop table public.customer_billing, public.invoice_settings, public.prices;
drop table if exists public.prices;
drop table if exists public.invoice_settings;
drop table if exists public.customer_billing;
alter table public.products drop column if exists price_unit;
drop function if exists public.set_week_invoice_number(date, int);
drop index if exists public.weeks_invoice_number_key;
alter table public.weeks drop column if exists invoice_number;

update public.profiles set role = 'viewer' where role = 'billing';
delete from public.role_permissions where role = 'billing' or area in ('invoices', 'prices');
delete from public.user_permissions where area in ('invoices', 'prices');
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('office', 'packing', 'viewer'));
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'office', 'packing', 'viewer'));
create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup'];
$$;
delete from supabase_migrations.schema_migrations where version = '20261028000100';
commit;
