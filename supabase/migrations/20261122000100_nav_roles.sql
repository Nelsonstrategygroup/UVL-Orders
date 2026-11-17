-- Navigation and roles (Lucas, 11/17/26).
--
-- * Two new permission areas, Off / View / Change: Weekly P&L ("pnl") and
--   Carcass weights ("carcass"), Off for every role but admins. They were
--   admins only.
-- * Setup is now "Operations setup" (products, parts per lamb, boxes, sizes,
--   box labels, Ships to): Change can be given (it was capped at View). Owner
--   setup (P&L Setup, producers, owners, users, export) stays admins only.
-- * Role defaults for Operations lead (was Office) and Accountant (was
--   Billing). The stored role codes stay office and billing, so nobody's
--   role or own overrides change.
-- * The database rules follow: the P&L and carcass weight tables by their
--   areas; anyone with P&L View can read what the P&L is worked out from
--   (orders, packing, pallets, invoices, prices, truck runs, carcass
--   weights, producers, rates), read only; the setup tables by Operations
--   setup.
--
-- Undo: supabase/rollback/20261122000100_revert.sql

create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup', 'invoices', 'prices', 'trucks', 'pnl', 'carcass'];
$$;

-- Only Print and download is capped at View for non-admins now (Setup can be Change).
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
        case when p_area = 'downloads' then 1 else 2 end)
    end
    from public.profiles p
    where p.id = auth.uid() and p.active
  ), 0)::smallint;
$$;


-- ---------------------------------------------------------------------------
-- Role defaults
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, area, level)
select r, a, 0 from unnest(array['office', 'packing', 'viewer', 'billing']) r, unnest(array['pnl', 'carcass']) a
on conflict (role, area) do nothing;

-- Operations lead (office): runs the week; no money screens.
update public.role_permissions set level = case area
    when 'week' then 2 when 'calls' then 2 when 'orders' then 2 when 'cutsheet' then 2 when 'packing' then 2
    when 'freezer' then 2 when 'customers' then 2 when 'callnotes' then 2 when 'halfwhole' then 2 when 'setup' then 2
    when 'downloads' then 1 when 'trucks' then 2
    else 0 end
where role = 'office';

-- Accountant (billing): invoices, and looks at orders, print (manifests), the P&L and carcass weights.
update public.role_permissions set level = case area
    when 'orders' then 1 when 'downloads' then 1 when 'pnl' then 1 when 'carcass' then 1
    when 'invoices' then 2 when 'trucks' then 2
    else 0 end
where role = 'billing';

-- ---------------------------------------------------------------------------
-- Weekly P&L tables: by the P&L area (were admins only). P&L Setup (the
-- categories and rates) and the owners list stay admin-only to change.
-- ---------------------------------------------------------------------------
drop policy "pnl_expenses: admin" on public.pnl_expenses;
create policy "pnl_expenses: read" on public.pnl_expenses for select to authenticated using ((select public.can_view('pnl')));
create policy "pnl_expenses: change" on public.pnl_expenses for all to authenticated
  using ((select public.can_change('pnl'))) with check ((select public.can_change('pnl')));
drop policy "pnl_income: admin" on public.pnl_income;
create policy "pnl_income: read" on public.pnl_income for select to authenticated using ((select public.can_view('pnl')));
create policy "pnl_income: change" on public.pnl_income for all to authenticated
  using ((select public.can_change('pnl'))) with check ((select public.can_change('pnl')));
drop policy "pnl_expense_files: admin" on public.pnl_expense_files;
create policy "pnl_expense_files: read" on public.pnl_expense_files for select to authenticated using ((select public.can_view('pnl')));
create policy "pnl_expense_files: change" on public.pnl_expense_files for all to authenticated
  using ((select public.can_change('pnl'))) with check ((select public.can_change('pnl')));

drop policy "pnl_adjustments: read" on public.pnl_adjustments;
drop policy "pnl_adjustments: add" on public.pnl_adjustments;
drop policy "pnl_adjustments: void" on public.pnl_adjustments;
create policy "pnl_adjustments: read" on public.pnl_adjustments for select to authenticated using ((select public.can_view('pnl')));
create policy "pnl_adjustments: add" on public.pnl_adjustments for insert to authenticated with check ((select public.can_change('pnl')));
create policy "pnl_adjustments: void" on public.pnl_adjustments for update to authenticated
  using ((select public.can_change('pnl'))) with check ((select public.can_change('pnl')));

drop policy "pnl_closed_weeks: read" on public.pnl_closed_weeks;
create policy "pnl_closed_weeks: read" on public.pnl_closed_weeks for select to authenticated using ((select public.can_view('pnl')));
drop policy "pnl_week_reviews: read" on public.pnl_week_reviews;
create policy "pnl_week_reviews: read" on public.pnl_week_reviews for select to authenticated using ((select public.can_view('pnl')));
drop policy "pnl_week_events: read" on public.pnl_week_events;
create policy "pnl_week_events: read" on public.pnl_week_events for select to authenticated using ((select public.can_view('pnl')));

create policy "pnl_owners: pnl read" on public.pnl_owners for select to authenticated using ((select public.can_view('pnl')));
create policy "expense_categories: pnl read" on public.expense_categories for select to authenticated using ((select public.can_view('pnl')));
create policy "expense_category_rates: pnl read" on public.expense_category_rates for select to authenticated using ((select public.can_view('pnl')));

-- ---------------------------------------------------------------------------
-- Carcass weights (were admins only): by the Carcass weights area; the P&L
-- reads them too. Producers and their rates: read with either, changed by
-- admins (Owner setup).
-- ---------------------------------------------------------------------------
drop policy "kill_sheets: admin" on public.kill_sheets;
drop policy "kill_lambs: admin" on public.kill_lambs;
drop policy "kill_adjustments: admin" on public.kill_adjustments;
drop policy "kill_sheet_photos: admin" on public.kill_sheet_photos;
create policy "kill_sheets: read" on public.kill_sheets for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));
create policy "kill_sheets: change" on public.kill_sheets for all to authenticated
  using ((select public.can_change('carcass'))) with check ((select public.can_change('carcass')));
create policy "kill_lambs: read" on public.kill_lambs for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));
create policy "kill_lambs: change" on public.kill_lambs for all to authenticated
  using ((select public.can_change('carcass'))) with check ((select public.can_change('carcass')));
create policy "kill_adjustments: read" on public.kill_adjustments for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));
create policy "kill_adjustments: change" on public.kill_adjustments for all to authenticated
  using ((select public.can_change('carcass'))) with check ((select public.can_change('carcass')));
create policy "kill_sheet_photos: read" on public.kill_sheet_photos for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));
create policy "kill_sheet_photos: change" on public.kill_sheet_photos for all to authenticated
  using ((select public.can_change('carcass'))) with check ((select public.can_change('carcass')));
create policy "producers: read" on public.producers for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));
create policy "producer_rates: read" on public.producer_rates for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));
create policy "lamb_cost_settings: read" on public.lamb_cost_settings for select to authenticated using ((select public.can_view_any(array['carcass', 'pnl'])));

-- ---------------------------------------------------------------------------
-- What the P&L is worked out from: readable (read only) with P&L View.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_lines', 'packing_weights', 'packing_lines', 'pallets', 'weeks', 'customers',
                           'invoices', 'invoice_lines', 'invoice_boxes', 'prices', 'carcass_charges', 'freight_charges',
                           'truck_runs', 'truck_run_stops', 'truck_drivers', 'truck_driver_rates'] loop
    execute format('create policy "%1$s: pnl read" on public.%1$I for select to authenticated using ((select public.can_view(''pnl'')))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Operations setup: boxes, box limits and box labels follow Setup like the
-- other setup tables (they were admins only).
-- ---------------------------------------------------------------------------
drop policy "box_types: change" on public.box_types;
create policy "box_types: change" on public.box_types for all to authenticated
  using ((select public.can_change('setup'))) with check ((select public.can_change('setup')));
drop policy "product_box_limits: change" on public.product_box_limits;
create policy "product_box_limits: change" on public.product_box_limits for all to authenticated
  using ((select public.can_change('setup'))) with check ((select public.can_change('setup')));
drop policy "gtin_products: change" on public.gtin_products;
create policy "gtin_products: change" on public.gtin_products for all to authenticated
  using ((select public.can_change('setup'))) with check ((select public.can_change('setup')));

-- ---------------------------------------------------------------------------
-- Files: P&L attachments and carcass weight photos follow their areas.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  drop policy if exists "pnl-files: read" on storage.objects;
  drop policy if exists "pnl-files: add" on storage.objects;
  drop policy if exists "pnl-files: delete" on storage.objects;
  drop policy if exists "kill-sheets: read" on storage.objects;
  drop policy if exists "kill-sheets: add" on storage.objects;
  drop policy if exists "kill-sheets: delete" on storage.objects;
  execute $p$ create policy "pnl-files: read" on storage.objects for select to authenticated
    using (bucket_id = 'pnl-files' and (select public.can_view('pnl'))) $p$;
  execute $p$ create policy "pnl-files: add" on storage.objects for insert to authenticated
    with check (bucket_id = 'pnl-files' and (select public.can_change('pnl'))) $p$;
  execute $p$ create policy "pnl-files: delete" on storage.objects for delete to authenticated
    using (bucket_id = 'pnl-files' and (select public.can_change('pnl'))) $p$;
  execute $p$ create policy "kill-sheets: read" on storage.objects for select to authenticated
    using (bucket_id = 'kill-sheets' and (select public.can_view_any(array['carcass', 'pnl']))) $p$;
  execute $p$ create policy "kill-sheets: add" on storage.objects for insert to authenticated
    with check (bucket_id = 'kill-sheets' and (select public.can_change('carcass'))) $p$;
  execute $p$ create policy "kill-sheets: delete" on storage.objects for delete to authenticated
    using (bucket_id = 'kill-sheets' and (select public.can_change('carcass'))) $p$;
end $$;
