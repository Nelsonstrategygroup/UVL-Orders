-- Undo 20261117000100_expense_category_methods.sql (undo 20261117000200
-- first, if it ran): removes the categories added by the
-- migration that have no expense entries, names the four starting
-- categories as before, and removes the rates table and the new columns.
-- Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261117000100_revert.sql

begin;

drop table public.expense_category_rates;
delete from public.expense_categories c
where (c.method <> 'entered' or c.name in ('Producer pay', 'Truck, repairs', 'Supplies'))
  and not exists (select 1 from public.pnl_expenses e where e.category_id = c.id);
update public.expense_categories set name = 'Butcher (Mohawk)', sort = 1 where name = 'Processing, Mohawk';
update public.expense_categories set name = 'Labor', sort = 2 where name = 'Labor, other';
update public.expense_categories set name = 'Freight', sort = 3 where name = 'Freight, other carriers';
update public.expense_categories set sort = 4 where name = 'Other';
drop index if exists public.expense_categories_one_weigh_sheets;
alter table public.expense_categories
  drop column group_name, drop column method, drop column income_base, drop column base_category_ids, drop column note;
delete from supabase_migrations.schema_migrations where version = '20261117000100';
commit;
