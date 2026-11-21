-- Freezer boxes, take-outs, counts and value (migration 20261125000100).

begin;
select plan(51);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000fb0a1', 'fz-admin@test.local'),
  ('00000000-0000-4000-8000-0000000fb0a2', 'fz-packer@test.local'),
  ('00000000-0000-4000-8000-0000000fb0a3', 'fz-viewer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000fb0a1', 'FZ Admin', 'admin'),
  ('00000000-0000-4000-8000-0000000fb0a2', 'FZ Packer', 'packing'),
  ('00000000-0000-4000-8000-0000000fb0a3', 'FZ Viewer', 'viewer');
insert into public.pnl_owners (name, profile_id) values ('FZ Admin', '00000000-0000-4000-8000-0000000fb0a1');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000fb0c1', 'FZ Emerson');
insert into public.weeks (id, invoice_number) values ('2099-11-02', 99801), ('2099-11-09', 99802);
insert into public.products (id, name, unit, group_name, price_unit, packed_with, sort) values
  ('fz-shanks', 'FZ Mixed Shanks', 'pack', 'Other', 'lb', '', 1),
  ('fz-sticks', 'FZ Pepper Sticks', 'case', 'Other', 'case', '', 2),
  ('fz-tongue', 'FZ Tongue', 'pack', 'Other', 'lb', '', 3),
  ('fz-heart', 'FZ Heart', 'each', 'Other', 'lb', 'FZ Organs', 4),
  ('fz-kidney', 'FZ Kidney', 'each', 'Other', 'lb', 'FZ Organs', 5);
insert into public.prices (product_id, price, effective_from) values
  ('fz-shanks', 7.55, '2099-01-01'), ('fz-sticks', 48, '2099-01-01'), ('fz-heart', 6, '2099-01-01');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-0000000fb0b1', '2099-11-09', '00000000-0000-4000-8000-0000000fb0c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values ('00000000-0000-4000-8000-0000000fb0b1', 'fz-shanks', 4);

select is((select percent from public.freezer_value_rates where effective_from = '2026-10-08'), 90::numeric,
  'the freezer value starts at 90% from Oct 8, 2026');
select is((select level from public.role_permissions where role = 'packing' and area = 'freezer'), 2::smallint,
  'the packing role can change the freezer');

-- As the packer: add a scanned box (the Emerson Mixed Shanks example).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000fb0a2","role":"authenticated"}';
select lives_ok($$ select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fb1a1","product_id":"fz-shanks","qty":16,
  "weight_lb":32.6,"gtin":"10698746488816","serial":"2631310052","lot":"123456","pack_date":"2099-10-28","source":"scan",
  "added_on":"2099-10-30","counts_as_income":true}') $$, 'the packer adds a scanned box');
select is((select week_id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a1'), '2099-11-02'::date,
  'it counts toward the order week holding the date');
select ok(not (select counts_as_income from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a1'),
  'a non-admin can''t count an add as freezer income');
select is((select l.qty from public.freezer_log l join public.freezer_boxes b on b.id = l.freezer_box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a1'), 16::numeric, 'it writes +16 to the freezer log');
select is((select l.note from public.freezer_log l join public.freezer_boxes b on b.id = l.freezer_box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a1'), 'Added manually', 'the log says why');
select is((select count(*)::int from public.freezer_box_values), 0, 'the packer can''t read the dollars');
select is((select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fb1a1","product_id":"fz-shanks","qty":16,"source":"scan"}')),
  (select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a1'), 'sending it twice saves it once');
select throws_ok($$ select public.add_to_freezer('{"product_id":"fz-shanks","qty":16,"gtin":"10698746488816","serial":"2631310052","source":"scan"}') $$,
  '23505', 'This box is already in the freezer.', 'the same box can''t be added twice');
select throws_ok($$ insert into public.freezer_boxes (product_id, qty, source, week_id) values ('fz-shanks', 1, 'manual', '2099-11-02') $$,
  '42501', null, 'boxes are only added through Add to freezer');
select throws_ok($$ select public.add_to_freezer('{"product_id":"fz-shanks","qty":2,"reason":"other","note":" "}') $$,
  '23514', null, 'Other needs a note');

-- A leftover from Packing counts by itself, in its packing week.
select lives_ok($$ select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fb1a2","product_id":"fz-tongue","qty":3,
  "weight_lb":4.2,"source":"packing","week_id":"2099-11-09","added_on":"2099-11-09"}') $$, 'the packer puts a leftover in the freezer');
select ok((select counts_as_income and reason = 'leftover' and week_id = '2099-11-09' from public.freezer_boxes
  where client_id = '00000000-0000-4000-8000-0000000fb1a2'), 'a packing leftover counts as that week''s freezer income');

-- Value, as an admin.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000fb0a1","role":"authenticated"}';
select is((select v.value from public.freezer_box_values v join public.freezer_boxes b on b.id = v.box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a1'), 221.52, '32.6 lb x 90% x $7.55 = $221.52');
select is((select v.note from public.freezer_box_values v join public.freezer_boxes b on b.id = v.box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a2'), 'No freezer value: no default price', 'no default price, no value');
select lives_ok($$ select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fb1a3","product_id":"fz-sticks","qty":2,
  "source":"manual","added_on":"2099-10-30","counts_as_income":true}') $$, 'an admin adds 2 cases and counts them as income');
select is((select v.value from public.freezer_box_values v join public.freezer_boxes b on b.id = v.box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a3'), 86.40, 'cases: 2 x 90% x $48 = $86.40');
select ok((select counts_as_income from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a3'),
  'an admin can count an add as freezer income');
select lives_ok($$ select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fb1a4","product_id":"fz-kidney","qty":10,
  "weight_lb":5,"source":"manual","added_on":"2099-10-30"}') $$, 'add kidneys');
select is((select v.price_product_id || ' ' || v.value from public.freezer_box_values v join public.freezer_boxes b on b.id = v.box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a4'), 'fz-heart 27.00', 'Kidney is valued at Heart''s price (packed together)');
select lives_ok($$ select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fb1a5","product_id":"fz-shanks","qty":2,
  "source":"manual","added_on":"2099-10-30"}') $$, 'add shanks with no weight');
select is((select v.note from public.freezer_box_values v join public.freezer_boxes b on b.id = v.box_id
  where b.client_id = '00000000-0000-4000-8000-0000000fb1a5'), 'No freezer value: no weight', 'a pound price needs a weight');
select lives_ok($$ select public.set_freezer_income((select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a1'), true) $$,
  'an admin counts the shanks box as freezer income afterward');

-- A box packed for a customer can't go in; a freezer box packed for an order comes out.
reset role;
insert into public.packing_weights (id, order_id, product_id, weight, gtin, serial) values
  ('00000000-0000-4000-8000-0000000fb0d1', '00000000-0000-4000-8000-0000000fb0b1', 'fz-shanks', 32.6, '10698746488816', '2631310052'),
  ('00000000-0000-4000-8000-0000000fb0d2', '00000000-0000-4000-8000-0000000fb0b1', 'fz-shanks', 20.1, '10698746488816', '2631310099');
set local role authenticated;
select ok((select qty_left = 0 from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a1'),
  'packed for an order: the box is out of the freezer');
select ok((select reason = 'packed' and week_id = '2099-11-09' and counts_in_pnl and qty = 16 from public.freezer_takes
  where packing_weight_id = '00000000-0000-4000-8000-0000000fb0d1'), 'the take-out is in the order''s week and takes back what it added');
select is((select l.qty from public.freezer_log l join public.freezer_takes t on t.id = l.freezer_take_id
  where t.packing_weight_id = '00000000-0000-4000-8000-0000000fb0d1'), -16::numeric, 'it writes -16 to the freezer log');
select throws_ok($$ select public.add_to_freezer('{"product_id":"fz-shanks","qty":8,"gtin":"10698746488816","serial":"2631310099","source":"scan"}') $$,
  '23505', 'This box is packed for FZ Emerson. It wasn''t added.', 'a box packed for a customer isn''t added');
reset role;
delete from public.packing_weights where id = '00000000-0000-4000-8000-0000000fb0d1';
set local role authenticated;
select ok((select qty_left = 16 from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a1')
  and not exists (select 1 from public.freezer_takes t join public.freezer_boxes b on b.id = t.box_id
    where b.client_id = '00000000-0000-4000-8000-0000000fb1a1'),
  'the box taken off the order is back in the freezer');

-- Take-outs and the log guard.
select throws_ok($$ select public.take_from_freezer(jsonb_build_object('box_id',
  (select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a4'), 'qty', 11)) $$,
  '23514', 'Only 10 left in that box.', 'never more than is left');
select lives_ok($$ select public.take_from_freezer(jsonb_build_object('box_id',
  (select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a4'), 'qty', 4, 'reason', 'discarded')) $$,
  'take 4 kidneys out as discarded');
select is((select qty_left from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a4'), 6::numeric, '6 left');
select throws_ok($$ delete from public.freezer_log where freezer_box_id = (select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a4') $$,
  '42501', null, 'a box''s freezer log line can''t be removed on its own');
select throws_ok($$ select public.remove_freezer_box((select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a4')) $$,
  'P0001', null, 'a box something was taken from can''t be removed');
select lives_ok($$ select public.remove_freezer_box((select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a5')) $$,
  'a box added by mistake is removed');
select is((select count(*)::int from public.freezer_log l where l.note = 'Added manually' and l.product_id = 'fz-shanks' and l.qty = 2), 0,
  'and its log line with it');

-- A closed week.
select lives_ok($$ select public.close_pnl_week('2099-11-02', '{}', '{}') $$, 'close the week of Nov 2');
select throws_ok($$ select public.remove_freezer_box((select id from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fb1a3')) $$,
  '55000', null, 'a box counting in a closed week can''t be removed');

-- Counts: one open at a time; a phone with scans waiting holds the apply.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000fb0a2","role":"authenticated"}';
insert into public.freezer_counts (id, kind, count_date) values ('00000000-0000-4000-8000-0000000fb2c1', 'stock_in', '2099-11-10');
select throws_ok($$ insert into public.freezer_counts (id, kind) values ('00000000-0000-4000-8000-0000000fb2c2', 'reconcile') $$,
  '23505', null, 'only one open count at a time');
insert into public.freezer_count_items (id, count_id, device_id, kind, product_id, qty, weight_lb, gtin, serial) values
  ('00000000-0000-4000-8000-0000000fb2d1', '00000000-0000-4000-8000-0000000fb2c1', 'phone-a', 'scan', 'fz-shanks', 12, 24.4, '10698746488816', '2631310077'),
  ('00000000-0000-4000-8000-0000000fb2d2', '00000000-0000-4000-8000-0000000fb2c1', 'phone-b', 'manual', 'fz-tongue', 2, 3.1, null, null);
select throws_ok($$ insert into public.freezer_count_items (id, count_id, device_id, kind, product_id, qty, gtin, serial) values
  ('00000000-0000-4000-8000-0000000fb2d3', '00000000-0000-4000-8000-0000000fb2c1', 'phone-b', 'scan', 'fz-shanks', 12, '10698746488816', '2631310077') $$,
  '23505', null, 'the same box counted on two phones is kept once');
select lives_ok($$ select public.freezer_count_checkin('00000000-0000-4000-8000-0000000fb2c1', 'phone-b', 'FZ Packer', 3) $$, 'phone B has 3 scans waiting');
select throws_ok($$ select public.apply_freezer_count('00000000-0000-4000-8000-0000000fb2c1',
  array['00000000-0000-4000-8000-0000000fb2d1', '00000000-0000-4000-8000-0000000fb2d2']::uuid[], '[]', '{}', true) $$,
  '42501', null, 'only an admin can apply while scans are waiting');
select is((select count(*)::int from public.freezer_boxes where count_id = '00000000-0000-4000-8000-0000000fb2c1'), 0,
  'nothing changes in inventory while counting');
select lives_ok($$ select public.freezer_count_checkin('00000000-0000-4000-8000-0000000fb2c1', 'phone-b', 'FZ Packer', 0) $$, 'phone B uploads');
select lives_ok($$ select public.apply_freezer_count('00000000-0000-4000-8000-0000000fb2c1',
  array['00000000-0000-4000-8000-0000000fb2d1', '00000000-0000-4000-8000-0000000fb2d2']::uuid[], '[]', '{"added":2}') $$,
  'the packer applies the stock-in count');
select ok((select count(*) = 2 and bool_and(reason = 'stock_in' and source = 'count' and added_on = '2099-11-10' and not counts_as_income)
  from public.freezer_boxes where count_id = '00000000-0000-4000-8000-0000000fb2c1'), 'both are added, not as income');
select throws_ok($$ update public.freezer_count_items set voided = true where id = '00000000-0000-4000-8000-0000000fb2d1' $$,
  '55000', null, 'a finished count can''t change');

-- A label the app didn't know: the packer's pick waits for an admin.
select lives_ok($$ select public.add_to_freezer('{"product_id":"fz-tongue","qty":3,"gtin":"10698746489288","serial":"u1","source":"scan","product_confirmed":false}') $$,
  'the packer saves a box from an unknown label with a product picked');
select throws_ok($$ select public.confirm_freezer_box((select id from public.freezer_boxes where serial = 'u1'), 'fz-shanks') $$,
  '42501', null, 'only an admin confirms it');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000fb0a1","role":"authenticated"}';
select lives_ok($$ select public.confirm_freezer_box((select id from public.freezer_boxes where serial = 'u1'), 'fz-shanks') $$,
  'an admin confirms the product');
select ok((select product_id = 'fz-shanks' and product_confirmed from public.freezer_boxes where serial = 'u1')
  and (select product_id = 'fz-shanks' from public.gtin_products where gtin = '10698746489288')
  and (select l.product_id = 'fz-shanks' from public.freezer_log l join public.freezer_boxes b on b.id = l.freezer_box_id where b.serial = 'u1'),
  'the box, its log line and the label all say the confirmed product');

select * from finish();
rollback;
