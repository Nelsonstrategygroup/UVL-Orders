-- Freight from pallets (migration 20261119000100): the three carriers with
-- their methods, rates and starting dates; gross or net; the columns' checks.

begin;
select plan(5);

select is((select string_agg(name || ' ' || method || ' ' || carrier || ' ' || delivery_kind, '; ' order by sort)
  from public.expense_categories where method in ('freight_weight', 'freight_pallet')),
  'Freight, Plymouth freight_weight Plymouth freight; Freight, Heritage cross-dock freight_pallet Heritage freight; '
  || 'Freight, Petersons to Plymouth freight_pallet Petersons freight',
  'the three carriers');
select is((select string_agg(c.name || ' ' || r.amount::text || ' from ' || r.effective_from, '; ' order by c.sort)
  from public.expense_category_rates r join public.expense_categories c on c.id = r.category_id
  where c.method in ('freight_weight', 'freight_pallet')),
  'Freight, Plymouth 0.0580 from 2026-10-08; Freight, Heritage cross-dock 25.0000 from 2026-10-08; Freight, Petersons to Plymouth 100.0000 from 2026-10-08',
  'their rates');
select is((select weight_basis from public.expense_categories where name = 'Freight, Plymouth'), 'gross', 'Plymouth bills gross weight');
select throws_ok($$ update public.expense_categories set weight_basis = 'tare' where name = 'Freight, Plymouth' $$, '23514', null,
  'gross or net only');
select throws_ok($$ update public.expense_category_rates set per_box_lb = -1 $$, '23514', null, 'no negative allowance');

select * from finish();
rollback;
