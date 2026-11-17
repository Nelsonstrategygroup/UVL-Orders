-- One list of expense categories (migration 20261117000100): the charges
-- moved into categories with their rates and dates; the starting list with
-- groups, methods and rates; one weigh sheets category; admins only.

begin;
select plan(9);

select is((select string_agg(group_name || ': ' || name || ' (' || method || ')', '; ' order by sort) from public.expense_categories
  where method not in ('per_truck_run', 'percent_category', 'freight_weight', 'freight_pallet')), -- (truck and freight came later)
  'Cost of product: Producer pay (weigh_sheets); Cost of product: Processing, Mohawk (entered); '
  || 'Delivery: Truck, insurance (fixed_weekly); Delivery: Truck, depreciation (fixed_weekly); Delivery: Truck, repairs (entered); '
  || 'Delivery: Freight, other carriers (entered); Operating: Marketing (percent_income); Operating: ALB/OSC assessments (per_lamb); '
  || 'Operating: Labor, other (entered); Operating: Supplies (entered); Operating: Other (entered)',
  'the starting list, in order');
select is((select r.effective_from::text || ' ' || r.amount::text from public.expense_category_rates r
  join public.expense_categories c on c.id = r.category_id where c.name = 'ALB/OSC assessments'), '2026-10-01 1.8000',
  'ALB/OSC keeps its rate and date');
select is((select r.effective_from::text || ' ' || r.percent::text || ' ' || c.income_base from public.expense_category_rates r
  join public.expense_categories c on c.id = r.category_id where c.name = 'Marketing'), '2026-10-01 4.0000 all',
  'Marketing keeps its rate and date, on all income');
select is((select jsonb_array_length(r.parts) || ' parts from ' || r.effective_from from public.expense_category_rates r
  join public.expense_categories c on c.id = r.category_id where c.name = 'Truck, insurance'), '4 parts from 2026-10-08',
  'insurance is built from four parts');
select ok(to_regclass('public.pnl_lamb_charges') is null and to_regclass('public.pnl_percent_charges') is null, 'the charge tables are gone');
select throws_ok($$ insert into public.expense_categories (name, method) values ('Second producer pay', 'weigh_sheets') $$,
  '23505', null, 'only one category comes from the weigh sheets');
select throws_ok($$ insert into public.expense_categories (name, method) values ('Bad', 'guess') $$, '23514', null, 'methods are from the list');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000e7a2', 'ecm-office@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-00000000e7a2', 'ECM Office', 'office');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e7a2","role":"authenticated"}';
select is((select count(*)::int from public.expense_category_rates), 0, 'office sees no rates');
select throws_ok($$ insert into public.expense_category_rates (category_id, effective_from, amount)
  values ('00000000-0000-4000-8000-00000000e7c1', '2027-01-01', 1) $$, '42501', null, 'office can''t add a rate');

select * from finish();
rollback;
