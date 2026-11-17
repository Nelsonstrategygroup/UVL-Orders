-- Undo 20261119000100_freight_from_pallets.sql: removes the three freight
-- carriers (and their rates) unless they have expense entries, and the new
-- columns. Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261119000100_revert.sql

begin;
delete from public.expense_categories c
where c.name in ('Freight, Plymouth', 'Freight, Heritage cross-dock', 'Freight, Petersons to Plymouth')
  and not exists (select 1 from public.pnl_expenses e where e.category_id = c.id);
alter table public.expense_category_rates drop column per_box_lb, drop column per_pallet_lb;
alter table public.expense_categories drop column carrier, drop column customer_ids, drop column weight_basis;
delete from supabase_migrations.schema_migrations where version = '20261119000100';
commit;
