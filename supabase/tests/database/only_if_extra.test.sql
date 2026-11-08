-- "Only if extra" order lines (migration 20261109000100): the customer
-- default for new lines, the fills the app keeps (only real changes, never
-- after packing starts), Kathy's shares, and invoices billing what a line
-- gets.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e6a1', 'extra-office@test.local'),
  ('00000000-0000-4000-8000-00000000e6a2', 'extra-packing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000e6a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-00000000e6a2', 'Packer', 'packing');
insert into public.customers (id, name, lines_only_if_extra) values
  ('00000000-0000-4000-8000-00000000e6c1', 'Extra Emerson', true),
  ('00000000-0000-4000-8000-00000000e6c2', 'Extra Firm', false);
insert into public.products (id, name, unit, group_name, price_unit) values
  ('ex-shanks', 'Extra shanks', 'pack', 'Other', 'lb'),
  ('ex-chops', 'Extra chops', 'each', 'Other', 'lb');

create function pg_temp.line(p_customer uuid, p_product text) returns public.order_lines language sql as $$
  select l.* from public.order_lines l join public.orders o on o.id = l.order_id
  where o.week_id = '2099-12-14' and o.customer_id = p_customer and l.product_id = p_product $$;
create function pg_temp.oid(p_customer uuid) returns uuid language sql as $$
  select id from public.orders where week_id = '2099-12-14' and customer_id = p_customer $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e6a1","role":"authenticated"}';
select public.set_order('2099-12-14', '00000000-0000-4000-8000-00000000e6c1', null, null, '{"ex-shanks": 54, "ex-chops": 6}', null);
select public.set_order('2099-12-14', '00000000-0000-4000-8000-00000000e6c2', null, null, '{"ex-shanks": 10}', null);
select ok((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-shanks')).only_if_extra, 'a new line starts as the customer''s default (only if extra)');
select ok(not (pg_temp.line('00000000-0000-4000-8000-00000000e6c2', 'ex-shanks')).only_if_extra, 'another customer''s line is firm');
select public.set_order('2099-12-14', '00000000-0000-4000-8000-00000000e6c1', null, null, '{"ex-shanks": 50, "ex-chops": 6}', null);
select ok((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-shanks')).only_if_extra, 'changing the amount keeps it');

-- The app keeps what each will get.
select is(public.set_extra_fills('2099-12-14', jsonb_build_array(
  jsonb_build_object('order_id', pg_temp.oid('00000000-0000-4000-8000-00000000e6c1'), 'product_id', 'ex-shanks', 'qty', 7),
  jsonb_build_object('order_id', pg_temp.oid('00000000-0000-4000-8000-00000000e6c2'), 'product_id', 'ex-shanks', 'qty', 3))), 1,
  'fills go on only-if-extra lines only');
select is((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-shanks')).fill_qty, 7::numeric, 'it will get 7');
select is(public.set_extra_fills('2099-12-14', jsonb_build_array(
  jsonb_build_object('order_id', pg_temp.oid('00000000-0000-4000-8000-00000000e6c1'), 'product_id', 'ex-shanks', 'qty', 7))), 0,
  'nothing changed: nothing written');

-- Kathy's share; a packer can't set one.
select lives_ok($$ select public.set_extra_choices('2099-12-14', jsonb_build_array(
  jsonb_build_object('order_id', pg_temp.oid('00000000-0000-4000-8000-00000000e6c1'), 'product_id', 'ex-shanks', 'qty', 5))) $$, 'Kathy splits');
select is((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-shanks')).fill_chosen, 5::numeric, 'her share is kept');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e6a2","role":"authenticated"}';
select throws_ok($$ select public.set_extra_choices('2099-12-14', '[]'::jsonb) $$, '42501', null, 'a packer can''t split extras');

-- Switching a line off starts it over.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e6a1","role":"authenticated"}';
update public.order_lines set only_if_extra = false
where order_id = pg_temp.oid('00000000-0000-4000-8000-00000000e6c1') and product_id = 'ex-chops';
update public.order_lines set only_if_extra = true
where order_id = pg_temp.oid('00000000-0000-4000-8000-00000000e6c1') and product_id = 'ex-chops';
select ok((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-chops')).fill_qty is null, 'switched: no fill until worked out again');

-- Packing starts: the fill stays.
reset role;
insert into public.packing_weights (order_id, product_id, weight)
values (pg_temp.oid('00000000-0000-4000-8000-00000000e6c1'), 'ex-shanks', 12.5);
select ok((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-shanks')).fill_locked, 'a box locks the line');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e6a1","role":"authenticated"}';
select is(public.set_extra_fills('2099-12-14', jsonb_build_array(
  jsonb_build_object('order_id', pg_temp.oid('00000000-0000-4000-8000-00000000e6c1'), 'product_id', 'ex-shanks', 'qty', 2))), 0,
  'and its fill no longer changes');
select is((pg_temp.line('00000000-0000-4000-8000-00000000e6c1', 'ex-shanks')).fill_qty, 7::numeric, 'still 7');

-- Invoices: ordered is what it gets; a line that gets nothing isn't a shorted line.
reset role;
update public.order_lines set fill_qty = 0
where order_id = pg_temp.oid('00000000-0000-4000-8000-00000000e6c1') and product_id = 'ex-chops';
select is((select ordered_qty from public.invoice_lines_from_packing('2099-12-14', '00000000-0000-4000-8000-00000000e6c1') where product_id = 'ex-shanks'),
  7::numeric, 'invoice: ordered is what it will get');
select is((select count(*)::int from public.invoice_lines_from_packing('2099-12-14', '00000000-0000-4000-8000-00000000e6c1') where product_id = 'ex-chops'),
  0, 'invoice: nothing to get, no shorted line');
select is(public.line_will_get(50, null, true, 7, 'pack', null), 7::numeric, 'what a line goes out as: its fill');

select * from finish();
rollback;
