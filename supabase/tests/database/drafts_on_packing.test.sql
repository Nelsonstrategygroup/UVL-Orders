-- Drafts on packing (migration 20261115000200): a box or a count saved makes
-- or refreshes the location's draft at once; a finalized invoice isn't
-- touched; a draft with nothing packed goes (unless it has a note); and a
-- problem with the draft never stops a box saving.

begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f2a1', 'dp-packer@test.local'),
  ('00000000-0000-4000-8000-00000000f2a2', 'dp-billing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f2a1', 'DP Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000f2a2', 'DP Biller', 'billing');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000f2c1', 'DP Market'),
  ('00000000-0000-4000-8000-00000000f2c2', 'DP Deli');
insert into public.customer_billing (customer_id, invoice_code) values
  ('00000000-0000-4000-8000-00000000f2c1', 'DPM'),
  ('00000000-0000-4000-8000-00000000f2c2', 'DPD');
insert into public.weeks (id, invoice_number) values ('2099-11-02', 99601);
insert into public.products (id, name, unit, group_name, price_unit) values
  ('dp-chops', 'DP chops', 'lb', 'Other', 'lb'),
  ('dp-sticks', 'DP sticks', 'each', 'Other', 'each');
insert into public.prices (product_id, price, effective_from) values ('dp-chops', 10, '2099-01-01'), ('dp-sticks', 3, '2099-01-01');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f2b1', '2099-11-02', '00000000-0000-4000-8000-00000000f2c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000f2b2', '2099-11-02', '00000000-0000-4000-8000-00000000f2c2', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000f2b1', 'dp-chops', 20),
  ('00000000-0000-4000-8000-00000000f2b2', 'dp-chops', 20),
  ('00000000-0000-4000-8000-00000000f2b2', 'dp-sticks', 4);

-- The packer saves a box: Market's draft is there at once, billing that box.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f2a1","role":"authenticated"}';
select lives_ok($$ insert into public.packing_weights (id, order_id, product_id, weight)
  values ('00000000-0000-4000-8000-00000000f2d1', '00000000-0000-4000-8000-00000000f2b1', 'dp-chops', 10.5) $$, 'the packer saves a box');
reset role;
select is((select count(*)::int from public.invoices where week_id = '2099-11-02'), 1, 'a draft for that location at once');
select is((select l.quantity from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f2c1' and l.kind = 'packed'), 10.5::numeric, 'billing the box');
select is((select number from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f2c1'), '99601-DPM', 'numbered as usual');

-- A second box and a reweigh follow straight away.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f2a1","role":"authenticated"}';
insert into public.packing_weights (id, order_id, product_id, weight)
  values ('00000000-0000-4000-8000-00000000f2d2', '00000000-0000-4000-8000-00000000f2b1', 'dp-chops', 9);
update public.packing_weights set weight = 11 where id = '00000000-0000-4000-8000-00000000f2d1';
-- A piece count on a per each product makes Deli's draft.
insert into public.packing_lines (order_id, product_id, packed_qty) values ('00000000-0000-4000-8000-00000000f2b2', 'dp-sticks', 4);
reset role;
select is((select l.quantity from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f2c1' and l.kind = 'packed'), 20::numeric, 'a new box and a reweigh show at once');
select is((select l.quantity from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f2c2' and l.product_id = 'dp-sticks'), 4::numeric, 'a piece count makes a draft too');

-- Finalized: packing changes don't touch it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f2a2","role":"authenticated"}';
select lives_ok($$ select public.finalize_invoice(id) from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f2c1' $$,
  'billing finalizes Market');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f2a1","role":"authenticated"}';
insert into public.packing_weights (order_id, product_id, weight) values ('00000000-0000-4000-8000-00000000f2b1', 'dp-chops', 5);
reset role;
select is((select status || ' ' || total::text from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f2c1'),
  'finalized 200.00', 'a box after finalizing doesn''t change the invoice');

-- Nothing packed any more: the draft goes, unless it has a note.
update public.invoices set memo = 'Keep me' where customer_id = '00000000-0000-4000-8000-00000000f2c2';
delete from public.packing_lines where order_id = '00000000-0000-4000-8000-00000000f2b2';
select is((select count(*)::int from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f2c2'), 1,
  'a draft with a note stays when nothing is packed');
update public.invoices set memo = '' where customer_id = '00000000-0000-4000-8000-00000000f2c2';
insert into public.packing_lines (order_id, product_id, packed_qty) values ('00000000-0000-4000-8000-00000000f2b2', 'dp-sticks', 1);
delete from public.packing_lines where order_id = '00000000-0000-4000-8000-00000000f2b2';
select is((select count(*)::int from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f2c2'), 0,
  'a draft with nothing packed and no note goes');

-- Opening the week afterwards finds nothing to do.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f2a2","role":"authenticated"}';
select is(public.sync_invoice_drafts('2099-11-02')::text, '0', 'opening the week makes no more drafts');
reset role;

-- A problem with the draft never stops a box saving.
create or replace function public.draft_for_location(p_week date, p_customer uuid) returns void
language plpgsql as $$ begin raise exception 'broken on purpose'; end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f2a1","role":"authenticated"}';
select lives_ok($$ insert into public.packing_weights (order_id, product_id, weight)
  values ('00000000-0000-4000-8000-00000000f2b2', 'dp-chops', 7) $$, 'the box saves even when the draft fails');
reset role;
select is((select count(*)::int from public.packing_weights where order_id = '00000000-0000-4000-8000-00000000f2b2'), 1, 'the box is there');
select is((select count(*)::int from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f2c2'), 0,
  'no draft yet; it catches up when the week is opened');

select * from finish();
rollback;
