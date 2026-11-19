-- Shank boxes count toward Mixed Shanks, and a box's product corrected by hand
-- (migrations 20261123000100 and 20261123000200; Lucas, 11/18/26).

begin;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000ab01', 'bc-packer@test.local'),
  ('00000000-0000-4000-8000-00000000ab02', 'bc-viewer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000ab01', 'BC Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000ab02', 'BC Viewer', 'viewer');
insert into public.products (id, name, unit, group_name, price_unit) values
  ('bc-mixed', 'BC Mixed', 'pack', 'Shanks', 'lb'),
  ('bc-trim', 'BC Trim', 'pack', 'Trim', 'lb'),
  ('bc-letrim', 'BC Le Trim', 'lb', 'Trim', 'lb');
insert into public.products (id, name, unit, group_name, price_unit, fills_product_id) values
  ('bc-front', 'BC Front', 'pack', 'Shanks', 'lb', 'bc-mixed'),
  ('bc-hind', 'BC Hind', 'pack', 'Shanks', 'lb', 'bc-mixed');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000abc1', 'BC Mixed store'),
  ('00000000-0000-4000-8000-00000000abc2', 'BC Front store'),
  ('00000000-0000-4000-8000-00000000abc3', 'BC Both store');
insert into public.weeks (id) values ('2099-09-07');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000abd1', '2099-09-07', '00000000-0000-4000-8000-00000000abc1', 'ordered'),
  ('00000000-0000-4000-8000-00000000abd2', '2099-09-07', '00000000-0000-4000-8000-00000000abc2', 'ordered'),
  ('00000000-0000-4000-8000-00000000abd3', '2099-09-07', '00000000-0000-4000-8000-00000000abc3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000abd1', 'bc-mixed', 30),
  ('00000000-0000-4000-8000-00000000abd1', 'bc-letrim', 140),
  ('00000000-0000-4000-8000-00000000abd2', 'bc-front', 4),
  ('00000000-0000-4000-8000-00000000abd3', 'bc-front', 4),
  ('00000000-0000-4000-8000-00000000abd3', 'bc-mixed', 6);

-- A Front box at a store that ordered Mixed.
insert into public.packing_weights (id, order_id, product_id, weight, off_order, slot, lot, gtin, serial) values
  ('00000000-0000-4000-8000-00000000abe1', '00000000-0000-4000-8000-00000000abd1', 'bc-mixed', 41.65, false, 1, '111326', '10000000000001', 's1'),
  ('00000000-0000-4000-8000-00000000abe2', '00000000-0000-4000-8000-00000000abd1', 'bc-front', 32.60, true, 1, '110626', '10000000000002', 's2');
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'), 'bc-mixed', 'a Front box counts as Mixed');
select is((select label_product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'), 'bc-front', 'its label is kept');
select is((select gtin from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'), '10000000000002', 'its GTIN is kept');
select is((select off_order from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'), false, 'it is on the order');
select is((select slot from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'), 2, 'it takes the next box in the Mixed row');
select is((select string_agg(product_id || ' ' || boxes || ' ' || quantity::numeric(9,2) || ' ' || not_on_order, ', ') from public.invoice_lines_from_packing('2099-09-07', '00000000-0000-4000-8000-00000000abc1') where kind = 'packed'),
  'bc-mixed 2 74.25 false', 'one Mixed Shanks invoice line with both boxes');

-- Its own line first; then Mixed once that line has its box.
insert into public.packing_weights (id, order_id, product_id, weight, lot) values
  ('00000000-0000-4000-8000-00000000abe3', '00000000-0000-4000-8000-00000000abd3', 'bc-front', 10, '1'),
  ('00000000-0000-4000-8000-00000000abe4', '00000000-0000-4000-8000-00000000abd3', 'bc-front', 11, '1');
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe3'), 'bc-front', 'the store''s own Front line is filled first');
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe4'), 'bc-mixed', 'with that line filled, the next box goes to Mixed');

-- A Hind box at a store with neither line stays Hind, not on the order.
insert into public.packing_weights (id, order_id, product_id, weight, off_order, lot) values
  ('00000000-0000-4000-8000-00000000abe5', '00000000-0000-4000-8000-00000000abd2', 'bc-hind', 9, true, '1');
select is((select product_id || ' ' || off_order from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe5'), 'bc-hind true', 'no Mixed line: stays Hind, not on the order');

-- Moved to a store with only Front: back to Front, on the order.
update public.packing_weights set order_id = '00000000-0000-4000-8000-00000000abd2' where id = '00000000-0000-4000-8000-00000000abe2';
select is((select product_id || ' ' || off_order || ' ' || coalesce(label_product_id, 'none') from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'),
  'bc-front false none', 'moved to a Front store it is Front again');
update public.packing_weights set order_id = '00000000-0000-4000-8000-00000000abd1' where id = '00000000-0000-4000-8000-00000000abe2';
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe2'), 'bc-mixed', 'moved back it is Mixed again');

-- The order changes: a Mixed line added later picks up the Hind box.
insert into public.order_lines (order_id, product_id, qty) values ('00000000-0000-4000-8000-00000000abd2', 'bc-mixed', 2);
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe5'), 'bc-mixed', 'a Mixed line added later picks up the box');
delete from public.order_lines where order_id = '00000000-0000-4000-8000-00000000abd2' and product_id = 'bc-mixed';
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe5'), 'bc-hind', 'the Mixed line removed: back to Hind');

-- Correcting a box by hand.
insert into public.packing_weights (id, order_id, product_id, weight, off_order, lot, gtin, serial) values
  ('00000000-0000-4000-8000-00000000abe6', '00000000-0000-4000-8000-00000000abd1', 'bc-trim', 20.40, true, '111326', '10000000000003', 's6');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ab02","role":"authenticated"}';
select throws_ok($$ select public.correct_box_product('00000000-0000-4000-8000-00000000abe6', 'bc-letrim', 'Mislabeled') $$, '42501', null, 'a viewer can''t change a box');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ab01","role":"authenticated"}';
select throws_ok($$ select public.correct_box_product('00000000-0000-4000-8000-00000000abe6', 'bc-letrim', '   ') $$, '22023', null, 'a reason is required');
select lives_ok($$ select public.correct_box_product('00000000-0000-4000-8000-00000000abe6', 'bc-letrim', 'Mislabeled') $$, 'a packer corrects a box');
reset role;
select is((select product_id || ' ' || label_product_id || ' ' || off_order || ' ' || correction_reason from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe6'),
  'bc-letrim bc-trim false Mislabeled', 'the box is Le Trim, the label kept, on the order');
select is((select corrected_by::text from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe6'), '00000000-0000-4000-8000-00000000ab01', 'who is recorded');
select ok((select corrected_at is not null from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe6'), 'when is recorded');
select is((select gtin || ' ' || serial from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe6'), '10000000000003 s6', 'GTIN and serial are kept');
select is((select quantity::numeric(9,2) from public.invoice_lines_from_packing('2099-09-07', '00000000-0000-4000-8000-00000000abc1') where product_id = 'bc-letrim'), 20.40::numeric(9,2), 'the invoice follows');
select is((select count(*)::int from public.invoice_lines_from_packing('2099-09-07', '00000000-0000-4000-8000-00000000abc1') where product_id = 'bc-trim'), 0, 'no Trim line left');

-- A corrected shank box isn't moved by the rule.
select public.correct_box_product('00000000-0000-4000-8000-00000000abe5', 'bc-trim', 'Really trim');
update public.packing_weights set order_id = '00000000-0000-4000-8000-00000000abd1' where id = '00000000-0000-4000-8000-00000000abe5';
select is((select product_id from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe5'), 'bc-trim', 'the rule leaves a corrected box alone');

-- Changing it back undoes the correction.
select public.correct_box_product('00000000-0000-4000-8000-00000000abe6', 'bc-trim', 'My mistake');
select is((select product_id || ' ' || off_order || ' ' || coalesce(correction_reason, 'none') || ' ' || coalesce(label_product_id, 'none') from public.packing_weights where id = '00000000-0000-4000-8000-00000000abe6'),
  'bc-trim true none none', 'picking the label''s product undoes it');

-- A finalized invoice stays as it is.
insert into public.packing_weights (id, order_id, product_id, weight, lot) values ('00000000-0000-4000-8000-00000000abe7', '00000000-0000-4000-8000-00000000abd2', 'bc-trim', 5, '1');
alter table public.invoices disable trigger user;
update public.invoices set status = 'finalized' where week_id = '2099-09-07' and customer_id = '00000000-0000-4000-8000-00000000abc2';
alter table public.invoices enable trigger user;
select throws_ok($$ select public.correct_box_product('00000000-0000-4000-8000-00000000abe7', 'bc-letrim', 'x') $$, 'P0001', null, 'refused on a finalized invoice');

select ok(not exists (select 1 from pg_constraint where conrelid = 'public.packing_weights'::regclass and contype = 'f' and confrelid = 'public.products'::regclass and conname <> 'packing_weights_product_id_fkey'),
  'one link from boxes to products (API embeds keep working)');

select * from finish();
rollback;
