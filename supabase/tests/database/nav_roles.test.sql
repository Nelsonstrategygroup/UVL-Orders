-- Navigation and roles (migration 20261122000100): what an Operations lead
-- (office), an Accountant (billing) and Packing can see and change in the
-- database, whatever the screens show.

begin;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000fb01', 'nr-lead@test.local'),
  ('00000000-0000-4000-8000-00000000fb02', 'nr-accountant@test.local'),
  ('00000000-0000-4000-8000-00000000fb03', 'nr-packer@test.local'),
  ('00000000-0000-4000-8000-00000000fb04', 'nr-viewer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000fb01', 'NR Lead', 'office'),
  ('00000000-0000-4000-8000-00000000fb02', 'NR Accountant', 'billing'),
  ('00000000-0000-4000-8000-00000000fb03', 'NR Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000fb04', 'NR Viewer', 'viewer');
insert into public.parts (id, name, per_lamb, unit) values ('nr-part', 'NR part', 1, 'each') on conflict do nothing;
insert into public.products (id, name, unit, group_name, price_unit) values ('nr-chops', 'NR chops', 'lb', 'Other', 'lb');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000fbc1', 'NR Market');
insert into public.weeks (id) values ('2099-08-03');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-00000000fbd1', '2099-08-03', '00000000-0000-4000-8000-00000000fbc1', 'ordered');
insert into public.packing_weights (order_id, product_id, weight) values ('00000000-0000-4000-8000-00000000fbd1', 'nr-chops', 10);
insert into public.expense_categories (id, name) values ('00000000-0000-4000-8000-00000000fbe1', 'NR expense');
insert into public.pnl_expenses (entry_date, category_id, amount) values ('2099-08-03', '00000000-0000-4000-8000-00000000fbe1', 50);
insert into public.producers (id, name) values ('00000000-0000-4000-8000-00000000fbf1', 'NR Ranch');
insert into public.kill_sheets (id, producer_id, kill_date, base_rate, live_factor, rate_source)
  values ('00000000-0000-4000-8000-00000000fbf2', '00000000-0000-4000-8000-00000000fbf1', '2099-07-31', 3, 2, 'base');
insert into public.contact_log (customer_id, kind, summary, created_by) values ('00000000-0000-4000-8000-00000000fbc1', 'call', 'NR note', '00000000-0000-4000-8000-00000000fb01');

set local role authenticated;

-- Operations lead: products and parts per lamb, yes; P&L, carcass weights, producers, no.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000fb01","role":"authenticated"}';
select is(public.perm('setup'), 2::smallint, 'lead: Change on Operations setup');
update public.parts set per_lamb = 3 where id = 'nr-part';
select is((select per_lamb from public.parts where id = 'nr-part'), 3::numeric, 'lead changes a parts-per-lamb number');
update public.products set name = 'NR chops, thick' where id = 'nr-chops';
select is((select name from public.products where id = 'nr-chops'), 'NR chops, thick', 'lead changes a product');
select is(public.perm('pnl'), 0::smallint, 'lead: P&L Off');
select is(public.perm('carcass'), 0::smallint, 'lead: Carcass weights Off');
select is(public.perm('invoices'), 0::smallint, 'lead: Invoices Off');
select is(public.perm('prices'), 0::smallint, 'lead: Prices Off');
select is_empty($$ select 1 from public.pnl_expenses $$, 'lead sees no P&L entries');
select is_empty($$ select 1 from public.kill_sheets $$, 'lead sees no carcass weights');
select is_empty($$ select 1 from public.producers $$, 'lead sees no producers');
select is_empty($$ select 1 from public.expense_categories $$, 'lead sees no P&L Setup');
select isnt_empty($$ select 1 from public.contact_log $$, 'lead reads call notes');

-- Accountant: views orders, print, the P&L and carcass weights; changes invoices; nothing operational.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000fb02","role":"authenticated"}';
select is(public.perm('invoices'), 2::smallint, 'accountant: Change on Invoices');
select is(public.perm('pnl'), 1::smallint, 'accountant: View on the P&L');
select isnt_empty($$ select 1 from public.pnl_expenses $$, 'accountant reads the P&L');
select throws_ok($$ insert into public.pnl_expenses (entry_date, category_id, amount) values ('2099-08-04', '00000000-0000-4000-8000-00000000fbe1', 5) $$,
  '42501', null, 'but can''t add to it');
select isnt_empty($$ select 1 from public.kill_sheets $$, 'accountant reads carcass weights');
select isnt_empty($$ select 1 from public.packing_weights $$, 'and what the P&L is worked out from (packed boxes)');
select throws_ok($$ select public.set_order('2099-08-03', '00000000-0000-4000-8000-00000000fbc1', 'none') $$, '42501', null,
  'accountant can''t change an order');
select is_empty($$ select 1 from public.half_whole_orders $$, 'accountant sees no half and whole orders');
select is_empty($$ select 1 from public.contact_log $$, 'accountant sees no call notes');
update public.parts set per_lamb = 7 where id = 'nr-part';
select is((select per_lamb from public.parts where id = 'nr-part'), 3::numeric, 'accountant can''t change setup');

-- Packing and Viewer: no P&L, no carcass weights.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000fb03","role":"authenticated"}';
select is(public.perm('pnl'), 0::smallint, 'packing: P&L Off');
select is_empty($$ select 1 from public.pnl_expenses $$, 'packing sees no P&L');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000fb04","role":"authenticated"}';
select is(public.perm('carcass'), 0::smallint, 'viewer: Carcass weights Off');
select is_empty($$ select 1 from public.kill_sheets $$, 'viewer sees no carcass weights');

reset role;
select * from finish();
rollback;
