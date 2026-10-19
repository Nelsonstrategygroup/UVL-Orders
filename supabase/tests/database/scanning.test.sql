-- Scanning stage 2 (SPEC 11): saving boxes from scans, duplicates, lots,
-- the GTIN map, and who may change what.

begin;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000005b1', 'sc-packer@test.local'),
  ('00000000-0000-4000-8000-0000000005b2', 'sc-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000005b3', 'sc-admin@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000005b1', 'Chris', 'packing'),
  ('00000000-0000-4000-8000-0000000005b2', 'Viewer', 'viewer'),
  ('00000000-0000-4000-8000-0000000005b3', 'Admin', 'admin');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-0000000005c1', 'SC Kirkland'),
  ('00000000-0000-4000-8000-0000000005c2', 'SC Fremont');
insert into public.weeks (id) values ('2099-09-07');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-0000000005d1', '2099-09-07', '00000000-0000-4000-8000-0000000005c1', 'ordered'),
  ('00000000-0000-4000-8000-0000000005d2', '2099-09-07', '00000000-0000-4000-8000-0000000005c2', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-0000000005d1', 'cp-french-rack', 10),
  ('00000000-0000-4000-8000-0000000005d2', 'cp-french-rack', 4);

set local role authenticated;

-- The admin teaches the French rack GTIN; a packer can't.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000005b3","role":"authenticated"}';
select lives_ok(
  $$ insert into public.gtin_products (gtin, product_id) values ('10698746488816', 'cp-french-rack') $$,
  'an admin maps a GTIN to a product');
select throws_ok(
  $$ insert into public.gtin_products (gtin, product_id) values ('1069874648881', 'cp-french-rack') $$,
  '23514', null, 'a GTIN is 14 digits');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000005b1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.gtin_products (gtin, product_id) values ('10698746489288', 'cp-le-trim') $$,
  '42501', null, 'a packer cannot teach a GTIN');

-- Chris scans a French rack box for Kirkland (real label 2).
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e1","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-french-rack","source":"scan","weight":22.15,"gtin":"10698746488816","serial":"2628710066",
     "serial_date":"2026-10-14","case_no":"10066","pack_date":"2026-10-14","lot":"528801",
     "raw_scan":"]C10110698746488816112610143202002215212628710066"}'::jsonb) ->> 'status'),
  'saved', 'a scanned box is saved');
select is(
  (select source || ':' || weight || ':' || lot || ':' || case_no || ':' || serial_date || ':' || box_no
   from public.packing_weights where serial = '2628710066'),
  'scan:22.15:528801:10066:2026-10-14:1', 'with its weight, lot, case number, label date, and box number');
select is((select lot from public.lots where gtin = '10698746488816' and pack_date = '2026-10-14'), '528801',
  'the lot is remembered for this GTIN and pack date');

-- The phone sends it again after a dropped connection.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e1","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-french-rack","source":"scan","weight":22.15,"gtin":"10698746488816","serial":"2628710066","lot":"528801"}'::jsonb) ->> 'status'),
  'already', 'sending the same upload twice saves it once');

-- Another phone scanned the same box for Fremont.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e2","order_id":"00000000-0000-4000-8000-0000000005d2",
     "product_id":"cp-french-rack","source":"scan","weight":22.15,"gtin":"10698746488816","serial":"2628710066","lot":"528801"}'::jsonb) ->> 'customer'),
  'SC Kirkland', 'the same box twice is refused, naming who has it');
select is(
  (select count(*)::int from public.packing_weights where serial = '2628710066'), 1, 'and is not saved again');
select is(
  (select kind from public.packing_conflicts where client_id = '00000000-0000-4000-8000-0000000005e2'), 'duplicate-box',
  'and is flagged for Kathy');

-- A second box, same GTIN and pack date, with a different lot: saved and flagged.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e3","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-french-rack","source":"scan","weight":21.9,"gtin":"10698746488816","serial":"2628710067",
     "pack_date":"2026-10-14","lot":"528802"}'::jsonb) ->> 'box_no'),
  '2', 'the next box is box 2');
select is((select kind from public.packing_conflicts where client_id = '00000000-0000-4000-8000-0000000005e3'), 'lot-differs',
  'a lot that differs from the one on file is flagged');

select throws_ok(
  $$ select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e4","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-french-rack","source":"manual","weight":20}'::jsonb) $$,
  '23514', null, 'every box needs a lot');

-- A box for a product that isn't on the order: saved; flagged unless the packer chose to add it.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e5","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-le-trim","source":"manual","weight":10,"lot":"528900"}'::jsonb) ->> 'status'),
  'saved', 'a box for a product not on the order is still saved');
select is((select kind from public.packing_conflicts where client_id = '00000000-0000-4000-8000-0000000005e5'), 'order-changed',
  'and flagged when the packer did not choose to add it');
select is(
  (select count(*)::int from public.packing_conflicts where client_id = '00000000-0000-4000-8000-0000000005e6')
   + (select (public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e6","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-le-trim","source":"manual","weight":10,"lot":"528900","off_order":true}'::jsonb) ->> 'box_no')::int) * 0
   + (select count(*)::int from public.packing_conflicts where client_id = '00000000-0000-4000-8000-0000000005e6'),
  0, 'not flagged when the packer chose "add it anyway"');

select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e7","order_id":"00000000-0000-4000-8000-0000000009d9",
     "product_id":"cp-french-rack","source":"scan","weight":20,"gtin":"10698746488816","serial":"2628710099","lot":"528801"}'::jsonb) ->> 'status'),
  'gone', 'a box for an order that no longer exists is flagged, not saved');

-- Lots: a packer can't change a box's lot once set; an admin can, and the audit log keeps the old one.
select throws_ok(
  $$ update public.packing_weights set lot = '999999' where serial = '2628710066' $$,
  '42501', null, 'a packer cannot change a box''s lot');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000005b3","role":"authenticated"}';
update public.packing_weights set lot = '528800' where serial = '2628710066';
select is(
  (select (old_data ->> 'lot') || '>' || (new_data ->> 'lot') || ':' || (user_id = '00000000-0000-4000-8000-0000000005b3')
   from public.audit_log where table_name = 'packing_weights' and action = 'update' and new_data ->> 'serial' = '2628710066'
   order by at desc limit 1),
  '528801>528800:true', 'an admin can, and the audit log records who and the old lot');

-- A viewer can see but not pack.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000005b2","role":"authenticated"}';
select throws_ok(
  $$ select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000005e8","order_id":"00000000-0000-4000-8000-0000000005d1",
     "product_id":"cp-french-rack","source":"manual","weight":10,"lot":"1"}'::jsonb) $$,
  '42501', null, 'a viewer cannot record boxes');
select throws_ok(
  $$ insert into public.pallets (week_id, ship_date, number) values ('2099-09-07', '2099-09-14', 1) $$,
  '42501', null, 'a viewer cannot add pallets');

reset role;
select * from finish();
rollback;
