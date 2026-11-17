-- Undo 20261122000100_nav_roles.sql: P&L and carcass weight tables back to
-- admins only, Setup back to View-only for non-admins, the role defaults as
-- before, and the two areas removed. Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261122000100_revert.sql

begin;
drop policy if exists "orders: pnl read" on public.orders;
drop policy if exists "order_lines: pnl read" on public.order_lines;
drop policy if exists "packing_weights: pnl read" on public.packing_weights;
drop policy if exists "packing_lines: pnl read" on public.packing_lines;
drop policy if exists "pallets: pnl read" on public.pallets;
drop policy if exists "weeks: pnl read" on public.weeks;
drop policy if exists "customers: pnl read" on public.customers;
drop policy if exists "invoices: pnl read" on public.invoices;
drop policy if exists "invoice_lines: pnl read" on public.invoice_lines;
drop policy if exists "invoice_boxes: pnl read" on public.invoice_boxes;
drop policy if exists "prices: pnl read" on public.prices;
drop policy if exists "carcass_charges: pnl read" on public.carcass_charges;
drop policy if exists "freight_charges: pnl read" on public.freight_charges;
drop policy if exists "truck_runs: pnl read" on public.truck_runs;
drop policy if exists "truck_run_stops: pnl read" on public.truck_run_stops;
drop policy if exists "truck_drivers: pnl read" on public.truck_drivers;
drop policy if exists "truck_driver_rates: pnl read" on public.truck_driver_rates;
drop policy if exists "pnl_expenses: read" on public.pnl_expenses;
drop policy if exists "pnl_expenses: change" on public.pnl_expenses;
create policy "pnl_expenses: admin" on public.pnl_expenses for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "pnl_income: read" on public.pnl_income;
drop policy if exists "pnl_income: change" on public.pnl_income;
create policy "pnl_income: admin" on public.pnl_income for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "pnl_expense_files: read" on public.pnl_expense_files;
drop policy if exists "pnl_expense_files: change" on public.pnl_expense_files;
create policy "pnl_expense_files: admin" on public.pnl_expense_files for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "kill_sheets: read" on public.kill_sheets;
drop policy if exists "kill_sheets: change" on public.kill_sheets;
create policy "kill_sheets: admin" on public.kill_sheets for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "kill_lambs: read" on public.kill_lambs;
drop policy if exists "kill_lambs: change" on public.kill_lambs;
create policy "kill_lambs: admin" on public.kill_lambs for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "kill_adjustments: read" on public.kill_adjustments;
drop policy if exists "kill_adjustments: change" on public.kill_adjustments;
create policy "kill_adjustments: admin" on public.kill_adjustments for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "kill_sheet_photos: read" on public.kill_sheet_photos;
drop policy if exists "kill_sheet_photos: change" on public.kill_sheet_photos;
create policy "kill_sheet_photos: admin" on public.kill_sheet_photos for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "pnl_adjustments: read" on public.pnl_adjustments;
drop policy if exists "pnl_adjustments: add" on public.pnl_adjustments;
drop policy if exists "pnl_adjustments: void" on public.pnl_adjustments;
create policy "pnl_adjustments: read" on public.pnl_adjustments for select to authenticated using ((select public.is_admin()));
create policy "pnl_adjustments: add" on public.pnl_adjustments for insert to authenticated with check ((select public.is_admin()));
create policy "pnl_adjustments: void" on public.pnl_adjustments for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "pnl_closed_weeks: read" on public.pnl_closed_weeks;
create policy "pnl_closed_weeks: read" on public.pnl_closed_weeks for select to authenticated using ((select public.is_admin()));
drop policy if exists "pnl_week_reviews: read" on public.pnl_week_reviews;
create policy "pnl_week_reviews: read" on public.pnl_week_reviews for select to authenticated using ((select public.is_admin()));
drop policy if exists "pnl_week_events: read" on public.pnl_week_events;
create policy "pnl_week_events: read" on public.pnl_week_events for select to authenticated using ((select public.is_admin()));
drop policy if exists "pnl_owners: pnl read" on public.pnl_owners;
drop policy if exists "expense_categories: pnl read" on public.expense_categories;
drop policy if exists "expense_category_rates: pnl read" on public.expense_category_rates;
drop policy if exists "producers: read" on public.producers;
drop policy if exists "producer_rates: read" on public.producer_rates;
drop policy if exists "lamb_cost_settings: read" on public.lamb_cost_settings;
drop policy if exists "box_types: change" on public.box_types;
create policy "box_types: change" on public.box_types for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "product_box_limits: change" on public.product_box_limits;
create policy "product_box_limits: change" on public.product_box_limits for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "gtin_products: change" on public.gtin_products;
create policy "gtin_products: change" on public.gtin_products for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  drop policy if exists "pnl-files: read" on storage.objects;
  drop policy if exists "pnl-files: add" on storage.objects;
  drop policy if exists "pnl-files: delete" on storage.objects;
  drop policy if exists "kill-sheets: read" on storage.objects;
  drop policy if exists "kill-sheets: add" on storage.objects;
  drop policy if exists "kill-sheets: delete" on storage.objects;
  execute $p$ create policy "pnl-files: read" on storage.objects for select to authenticated using (bucket_id = 'pnl-files' and (select public.is_admin())) $p$;
  execute $p$ create policy "pnl-files: add" on storage.objects for insert to authenticated with check (bucket_id = 'pnl-files' and (select public.is_admin())) $p$;
  execute $p$ create policy "pnl-files: delete" on storage.objects for delete to authenticated using (bucket_id = 'pnl-files' and (select public.is_admin())) $p$;
  execute $p$ create policy "kill-sheets: read" on storage.objects for select to authenticated using (bucket_id = 'kill-sheets' and (select public.is_admin())) $p$;
  execute $p$ create policy "kill-sheets: add" on storage.objects for insert to authenticated with check (bucket_id = 'kill-sheets' and (select public.is_admin())) $p$;
  execute $p$ create policy "kill-sheets: delete" on storage.objects for delete to authenticated using (bucket_id = 'kill-sheets' and (select public.is_admin())) $p$;
end $$;

-- Role defaults as they were on 11/17/26.
update public.role_permissions r set level = v.level from (values
  ('office', 'callnotes', 2), ('office', 'calls', 2), ('office', 'customers', 2), ('office', 'cutsheet', 2), ('office', 'downloads', 1),
  ('office', 'freezer', 2), ('office', 'halfwhole', 2), ('office', 'invoices', 1), ('office', 'orders', 2), ('office', 'packing', 2),
  ('office', 'prices', 1), ('office', 'setup', 1), ('office', 'trucks', 2), ('office', 'week', 2),
  ('billing', 'callnotes', 0), ('billing', 'calls', 0), ('billing', 'customers', 1), ('billing', 'cutsheet', 0), ('billing', 'downloads', 1),
  ('billing', 'freezer', 0), ('billing', 'halfwhole', 0), ('billing', 'invoices', 2), ('billing', 'orders', 1), ('billing', 'packing', 1),
  ('billing', 'prices', 2), ('billing', 'setup', 1), ('billing', 'trucks', 2), ('billing', 'week', 1)
) v(role, area, level) where r.role = v.role and r.area = v.area;
delete from public.user_permissions where area in ('pnl', 'carcass');
delete from public.role_permissions where area in ('pnl', 'carcass');
create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup', 'invoices', 'prices', 'trucks'];
$$;
create or replace function public.perm(p_area text)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'admin' then 2
      else least(
        coalesce(
          (select u.level from public.user_permissions u where u.user_id = p.id and u.area = p_area),
          (select r.level from public.role_permissions r where r.role = p.role and r.area = p_area),
          0),
        case when p_area in ('setup', 'downloads') then 1 else 2 end)
    end
    from public.profiles p
    where p.id = auth.uid() and p.active
  ), 0)::smallint;
$$;
delete from supabase_migrations.schema_migrations where version = '20261122000100';
commit;
