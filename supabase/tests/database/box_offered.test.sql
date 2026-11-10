-- The stores Chris saw when he tapped a box's store (migration
-- 20261110000200): record_box keeps what the app sends as offered, and a box
-- without it (typed, or one store) leaves it blank.

begin;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000b0f01', 'offered-packer@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-0000000b0f01', 'Packer', 'packing');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000b0fc1', 'Offered Burien');
insert into public.products (id, name, unit, group_name, price_unit) values ('of-shanks', 'Offered shanks', 'pack', 'Other', 'lb');
insert into public.weeks (id) values ('2099-12-14') on conflict do nothing;
insert into public.orders (id, week_id, customer_id) values ('00000000-0000-4000-8000-0000000b0f0a', '2099-12-14', '00000000-0000-4000-8000-0000000b0fc1');
insert into public.order_lines (order_id, product_id, qty) values ('00000000-0000-4000-8000-0000000b0f0a', 'of-shanks', 5);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b0f01","role":"authenticated"}';

select is((public.record_box(jsonb_build_object(
  'client_id', '00000000-0000-4000-8000-0000000b0f11', 'order_id', '00000000-0000-4000-8000-0000000b0f0a',
  'product_id', 'of-shanks', 'weight', 5.9, 'lot', '110626', 'gtin', '10000000000001', 'serial', '9000000001',
  'route', 'other', 'offered', '#12 Redmond, #17 Burien, Emerson'))) ->> 'status', 'saved', 'a tapped box saves');
select is((select offered from public.packing_weights where client_id = '00000000-0000-4000-8000-0000000b0f11'),
  '#12 Redmond, #17 Burien, Emerson', 'it keeps the stores Chris saw');

select public.record_box(jsonb_build_object(
  'client_id', '00000000-0000-4000-8000-0000000b0f12', 'order_id', '00000000-0000-4000-8000-0000000b0f0a',
  'product_id', 'of-shanks', 'weight', 6.1, 'lot', '110626', 'gtin', '10000000000001', 'serial', '9000000002', 'route', 'suggested'));
select is((select offered from public.packing_weights where client_id = '00000000-0000-4000-8000-0000000b0f12'), null, 'one store, nothing to choose: blank');

select * from finish();
rollback;
