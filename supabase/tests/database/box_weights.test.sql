-- A weight for every box (change request 10/26/26): each weight keeps which
-- box of the customer's product it is (slot) and its label number, from a
-- scan or typed in from the paper sheet; the blank settings.

begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000007b1', 'bw-packer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000007b1', 'Chris', 'packing');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000007c1', 'BW Kirkland');
insert into public.weeks (id) values ('2099-10-05');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-0000000007d1', '2099-10-05', '00000000-0000-4000-8000-0000000007c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty, unit) values
  ('00000000-0000-4000-8000-0000000007d1', 'cp-le-trim', 120, 'lb');

select is((select pack_unknown_blanks || ':' || pack_spare_blanks from public.app_settings), '6:2',
  '6 blanks when the box count is unknown, 2 spares');
select is((select pack_blanks from public.products where id = 'cp-le-trim'), null::int, 'no product sets its own blanks yet');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000007b1","role":"authenticated"}';

-- A scan lands on box 2 of Le Trim, label 15.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000007e1","order_id":"00000000-0000-4000-8000-0000000007d1",
     "product_id":"cp-le-trim","source":"scan","weight":44.6,"gtin":"10698746489288","serial":"2628710099",
     "pack_date":"2026-10-14","lot":"528801","slot":2,"label_no":15}'::jsonb) ->> 'status'),
  'saved', 'a scanned box is saved');
select is((select slot || ':' || label_no from public.packing_weights where client_id = '00000000-0000-4000-8000-0000000007e1'),
  '2:15', 'with the box it went in and its label number');

-- An older phone that doesn't send a box still saves.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000007e2","order_id":"00000000-0000-4000-8000-0000000007d1",
     "product_id":"cp-le-trim","source":"manual","weight":30,"lot":"528801"}'::jsonb) ->> 'status'),
  'saved', 'a box without a slot still saves');

-- Typed in from the paper sheet: a spare blank with a label number Chris wrote.
select lives_ok(
  $$ insert into public.packing_weights (order_id, product_id, weight, slot, label_no)
     values ('00000000-0000-4000-8000-0000000007d1', 'cp-le-trim', 41.2, 4, 31) $$,
  'a weight from the paper sheet keeps its blank and label number');
select throws_ok(
  $$ insert into public.packing_weights (order_id, product_id, weight, slot) values ('00000000-0000-4000-8000-0000000007d1', 'cp-le-trim', 1, 0) $$,
  '23514', null, 'a box number starts at 1');

select * from finish();
rollback;
