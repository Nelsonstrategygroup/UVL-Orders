-- Freight from pallets (Lucas, 11/16/26), stage C of one list of expense
-- categories. A freight category has its carrier, the locations it covers
-- (a chain covers all its stores), and a rate from a date on:
--
--   freight_weight   $ per lb of the covered boxes on the week's pallets.
--                    Gross (Lucas: Plymouth likely bills gross weight) adds
--                    lb per box and lb per pallet to the boxes' meat weight;
--                    net is the meat weight only. Switchable per category.
--   freight_pallet   $ per pallet carrying any covered box.
--
-- Pallets and the boxes on them are what the app already records each week
-- (Packing > Pallets, and each box's pallet).
--
-- Starting carriers, rates from Oct 8, 2026:
--   Freight, Plymouth                  $0.058 a lb (gross; 0 lb per box and per pallet until known)
--                                      PCC stores, Key City, Port Townsend
--   Freight, Heritage cross-dock       $25 per PCC pallet
--   Freight, Petersons to Plymouth     $100 per PCC pallet
--
-- Adds columns only (categories: carrier, customer_ids, weight_basis; rates:
-- per_box_lb, per_pallet_lb) and three categories. No foreign keys.
--
-- Undo: supabase/rollback/20261119000100_revert.sql

alter table public.expense_categories
  add column carrier text not null default '',
  add column customer_ids uuid[] not null default '{}',
  add column weight_basis text not null default 'gross' check (weight_basis in ('gross', 'net'));
comment on column public.expense_categories.carrier is 'Freight: who carries it (Plymouth, Heritage, Petersons).';
comment on column public.expense_categories.customer_ids is 'Freight: the locations it covers. A chain (a customer with locations) covers all its stores.';
comment on column public.expense_categories.weight_basis is 'freight_weight: gross (box meat weight + lb per box + lb per pallet, from the rate) or net (meat weight only).';

alter table public.expense_category_rates
  add column per_box_lb numeric(8, 2) check (per_box_lb is null or per_box_lb >= 0),
  add column per_pallet_lb numeric(8, 2) check (per_pallet_lb is null or per_pallet_lb >= 0);
comment on column public.expense_category_rates.per_box_lb is 'freight_weight, gross: lb added per box (box, ice) to its meat weight.';
comment on column public.expense_category_rates.per_pallet_lb is 'freight_weight, gross: lb added per pallet (the pallet, wrap).';

do $$
declare
  v_pcc uuid := (select p.id from public.customers p where p.name = 'PCC' and exists (select 1 from public.customers c where c.parent_customer_id = p.id) limit 1);
  v_plymouth uuid[] := array_remove(array[
    (select p.id from public.customers p where p.name = 'PCC' and exists (select 1 from public.customers c where c.parent_customer_id = p.id) limit 1),
    (select id from public.customers where name = 'Key City' limit 1),
    (select id from public.customers where name = 'Port Townsend' limit 1)
  ], null);
begin
  perform set_config('uvl.source', 'freight from pallets (Lucas 11/16/26)', true);
  insert into public.expense_categories (name, group_name, method, delivery_kind, carrier, customer_ids, weight_basis, sort) values
    ('Freight, Plymouth', 'Delivery', 'freight_weight', 'freight', 'Plymouth', v_plymouth, 'gross', 170),
    ('Freight, Heritage cross-dock', 'Delivery', 'freight_pallet', 'freight', 'Heritage', array_remove(array[v_pcc], null), 'gross', 180),
    ('Freight, Petersons to Plymouth', 'Delivery', 'freight_pallet', 'freight', 'Petersons', array_remove(array[v_pcc], null), 'gross', 190)
  on conflict (name) do nothing;

  insert into public.expense_category_rates (category_id, effective_from, amount, per_box_lb, per_pallet_lb, note)
  select id, '2026-10-08', 0.058, 0, 0, 'Per lb of pallet weight (Lucas, 11/16/26). Gross: set lb per box and per pallet when known.'
  from public.expense_categories where name = 'Freight, Plymouth'
  on conflict (category_id, effective_from) do nothing;
  insert into public.expense_category_rates (category_id, effective_from, amount, note)
  select id, '2026-10-08', 25, 'Per PCC pallet (Lucas, 11/16/26)' from public.expense_categories where name = 'Freight, Heritage cross-dock'
  on conflict (category_id, effective_from) do nothing;
  insert into public.expense_category_rates (category_id, effective_from, amount, note)
  select id, '2026-10-08', 100, 'Per PCC pallet (Lucas, 11/16/26)' from public.expense_categories where name = 'Freight, Petersons to Plymouth'
  on conflict (category_id, effective_from) do nothing;
end $$;
