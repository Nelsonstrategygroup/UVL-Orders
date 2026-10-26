-- Scan-to-pallet routing (change request 10/26/26): distributors and Ships
-- to, starting pallets (safe to send twice), boxes with their pallet, box
-- type and route, unassigned boxes, and flags for over-packing and a tag
-- used twice.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000008b1', 'pr-packer@test.local'),
  ('00000000-0000-4000-8000-0000000008b2', 'pr-viewer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000008b1', 'Chris', 'packing'),
  ('00000000-0000-4000-8000-0000000008b2', 'Viewer', 'viewer');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-0000000008c1', 'PR Direct Co');
insert into public.weeks (id) values ('2099-11-02');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-0000000008d1', '2099-11-02', '00000000-0000-4000-8000-0000000008c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty, unit) values
  ('00000000-0000-4000-8000-0000000008d1', 'cp-le-trim', 45, 'lb');

-- Seeded: one distributor, and every PCC location ships to it.
select is((select count(*)::int from public.consolidation_points where name = 'PCC distributor'), 1, 'the PCC distributor is set up');
select is(
  (select count(*)::int from public.customers c join public.customers p on p.id = c.parent_customer_id
   where p.name = 'PCC' and c.ships_to_point_id is distinct from (select id from public.consolidation_points where name = 'PCC distributor')),
  0, 'every PCC location ships to the PCC distributor');
select is((select ships_to_point_id::text from public.customers where id = '00000000-0000-4000-8000-0000000008c1'), null::text,
  'a customer starts as Direct');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000008b1","role":"authenticated"}';

-- Chris starts pallet P1 for the direct customer.
select is(
  (select public.start_pallet('{"id":"00000000-0000-4000-8000-0000000008e1","week_id":"2099-11-02","tag":"P1",
     "ship_to_customer_id":"00000000-0000-4000-8000-0000000008c1"}'::jsonb) ->> 'status'),
  'saved', 'a packer starts a pallet');
select is((select tag || ':' || status from public.pallets where id = '00000000-0000-4000-8000-0000000008e1'), 'P1:open', 'tagged and open');
select is(
  (select count(*)::int from public.pallet_shipments ps join public.shipments s on s.id = ps.shipment_id
   where ps.pallet_id = '00000000-0000-4000-8000-0000000008e1' and s.ship_to_customer_id = '00000000-0000-4000-8000-0000000008c1'),
  1, 'linked to the customer''s shipment for the week');
select is(
  (select public.start_pallet('{"id":"00000000-0000-4000-8000-0000000008e1","week_id":"2099-11-02","tag":"P1",
     "ship_to_customer_id":"00000000-0000-4000-8000-0000000008c1"}'::jsonb) ->> 'status'),
  'already', 'sending it again saves it once');

-- A second pallet for the same shipment reuses the shipment; the same tag is flagged.
select is(
  (select public.start_pallet('{"id":"00000000-0000-4000-8000-0000000008e2","week_id":"2099-11-02","tag":"p1",
     "ship_to_customer_id":"00000000-0000-4000-8000-0000000008c1"}'::jsonb) ->> 'status'),
  'saved', 'a second pallet for the shipment is saved');
select is((select count(*)::int from public.shipments where week_id = '2099-11-02'), 1, 'one shipment, two pallets');
select is((select count(*)::int from public.packing_conflicts where kind = 'pallet-tag'), 1, 'the repeated tag is flagged');

-- A routed box: pallet, box type, route, and what was suggested.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000008f1","order_id":"00000000-0000-4000-8000-0000000008d1",
     "product_id":"cp-le-trim","source":"scan","weight":44.6,"gtin":"10698746489288","serial":"PR1","lot":"528801",
     "pallet_id":"00000000-0000-4000-8000-0000000008e1","box_type_id":"mvm","route":"suggested","slot":1,"planned_boxes":1}'::jsonb) ->> 'status'),
  'saved', 'a routed box is saved');
select is(
  (select pallet_id::text || ':' || coalesce(box_type_id, '-') || ':' || route from public.packing_weights where client_id = '00000000-0000-4000-8000-0000000008f1'),
  '00000000-0000-4000-8000-0000000008e1:mvm:suggested', 'with its pallet, box type and route');

-- A second box where one was planned (another phone, offline): saved and flagged.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000008f2","order_id":"00000000-0000-4000-8000-0000000008d1",
     "product_id":"cp-le-trim","source":"scan","weight":40,"gtin":"10698746489288","serial":"PR2","lot":"528801","planned_boxes":1}'::jsonb) ->> 'status'),
  'saved', 'over-packing is saved, not refused');
select is((select count(*)::int from public.packing_conflicts where kind = 'over-packed'), 1, 'and flagged for review');

-- An unassigned box: no order, just the week.
select is(
  (select public.record_box('{"client_id":"00000000-0000-4000-8000-0000000008f3","week_id":"2099-11-02",
     "product_id":"cp-le-trim","source":"scan","weight":30,"gtin":"10698746489288","serial":"PR3","lot":"528801","route":"unassigned"}'::jsonb) ->> 'status'),
  'saved', 'an unassigned box is saved');
select throws_ok(
  $$ insert into public.packing_weights (product_id, weight) values ('cp-le-trim', 1) $$,
  '23514', null, 'a box needs an order or a week');

select * from finish();
rollback;
