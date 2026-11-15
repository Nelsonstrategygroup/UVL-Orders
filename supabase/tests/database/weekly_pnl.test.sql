-- Lamb cost, stage 3 (migration 20261114000300): P&L charges, expense
-- categories, expense and income entries. Admins only; each entry counts
-- toward the order week containing its date; customers are untouched.

begin;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e0a1', 'pnl-admin@test.local'),
  ('00000000-0000-4000-8000-00000000e0a2', 'pnl-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000e0a1', 'PNL Admin', 'admin'),
  ('00000000-0000-4000-8000-00000000e0a2', 'PNL Office', 'office');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000e0c1', 'PNL Market');

select is((select name || ' ' || per_lamb::text || ' ' || effective_from::text from public.pnl_lamb_charges), 'ALB/OSC 1.8000 2026-10-01',
  'ALB/OSC starts at $1.80 per lamb');
select is((select name || ' ' || percent::text from public.pnl_percent_charges), 'Marketing 4.0000', 'Marketing starts at 4%');
select is((select string_agg(name, ', ' order by sort) from public.expense_categories), 'Butcher (Mohawk), Labor, Freight, Other',
  'the four starting categories');
select is(public.order_week('2026-11-12'), '2026-11-16'::date, 'a Thursday belongs to the next packing Monday');
select is(public.order_week('2026-11-18'), '2026-11-16'::date, 'a Wednesday belongs to that week''s Monday');
select is(public.order_week('2026-11-19'), '2026-11-23'::date, 'the next Thursday starts a new week');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a1","role":"authenticated"}';

select lives_ok($$ insert into public.pnl_expenses (entry_date, category_id, amount, note)
  select '2026-11-13', id, 1250.00, 'kill fee' from public.expense_categories where name = 'Butcher (Mohawk)' $$, 'an admin enters an expense');
select is((select week_id::text from public.pnl_expenses), '2026-11-16', 'the expense counts toward its week');
select throws_ok($$ insert into public.pnl_expenses (entry_date, category_id, amount)
  select '2026-11-13', id, 0 from public.expense_categories where name = 'Labor' $$, '23514', null, 'an expense isn''t 0');
select lives_ok($$ insert into public.pnl_income (entry_date, customer_id, customer_name, amount)
  values ('2026-11-17', '00000000-0000-4000-8000-00000000e0c1', 'PNL Market', 980.50) $$, 'an admin enters income');
select lives_ok($$ insert into public.pnl_income (entry_date, customer_id, customer_name, amount)
  values ('2026-11-18', '00000000-0000-4000-8000-00000000e0c1', 'PNL Market', 100) $$, 'more income the same week');
select is((select sum(amount)::text from public.pnl_income where week_id = '2026-11-16'), '1080.50', 'entries in a week add up');
select throws_ok($$ insert into public.pnl_lamb_charges (name, effective_from, per_lamb) values ('ALB/OSC', '2026-10-01', 2) $$,
  '23505', null, 'one charge per name per start date');
select lives_ok($$ insert into public.pnl_lamb_charges (name, effective_from, per_lamb) values ('ALB/OSC', '2027-01-04', 2) $$,
  'a new ALB/OSC rate from a later date');
select throws_ok($$ insert into public.pnl_percent_charges (name, effective_from, percent) values ('Too much', '2026-10-01', 101) $$,
  '23514', null, 'a percent is 0 to 100');
select lives_ok($$ update public.expense_categories set name = 'Freight out', active = false where name = 'Freight' $$,
  'a category can be renamed and retired');
select throws_ok($$ delete from public.expense_categories where name = 'Butcher (Mohawk)' $$,
  '23503', null, 'a category with expenses can''t be deleted');

-- Office sees nothing.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a2","role":"authenticated"}';
select is((select count(*)::int from public.pnl_income), 0, 'office sees no income');
select is((select count(*)::int from public.expense_categories), 0, 'office sees no categories');

-- Customers are untouched: one with income entries can still be deleted.
reset role;
select lives_ok($$ delete from public.customers where id = '00000000-0000-4000-8000-00000000e0c1' $$,
  'a customer with income entries can still be deleted');

select * from finish();
rollback;
