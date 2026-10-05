-- Packing (Phase 3): the packing role can mark lines and set boxes, and the
-- database records who did it, whatever the device sends.

begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'pk-office@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'pk-packing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-0000000000b2', 'Chris', 'packing');
insert into public.products (id, name, unit, group_name) values ('pk-leg', 'Test leg', 'each', 'Legs');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000c3', 'Pack Test Market');
insert into public.weeks (id) values ('2099-02-02');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000000d4', '2099-02-02', '00000000-0000-4000-8000-0000000000c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values ('00000000-0000-4000-8000-0000000000d4', 'pk-leg', 4);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';

-- The device claims someone else packed it; the database records the real packer.
select lives_ok(
  $$ insert into public.packing_lines (order_id, product_id, packed_qty, packed_by, packed_at)
     values ('00000000-0000-4000-8000-0000000000d4', 'pk-leg', 4,
             '00000000-0000-4000-8000-0000000000a1', '2000-01-01') $$,
  'packing can mark a line packed'
);
select is(
  (select packed_by::text from public.packing_lines where product_id = 'pk-leg'),
  '00000000-0000-4000-8000-0000000000b2',
  'packed_by is the person logged in, not what the device sent'
);
select ok(
  (select packed_at > now() - interval '1 minute' from public.packing_lines where product_id = 'pk-leg'),
  'packed_at is the time it was saved'
);

select lives_ok(
  $$ insert into public.packing_orders (order_id, boxes, pallet)
     values ('00000000-0000-4000-8000-0000000000d4', 3, 'A2')
     on conflict (order_id) do update set boxes = excluded.boxes, pallet = excluded.pallet $$,
  'packing can set boxes and pallet'
);
select is(
  (select updated_by::text || ':' || boxes || ':' || pallet from public.packing_orders),
  '00000000-0000-4000-8000-0000000000b2:3:A2',
  'boxes and pallet are saved with who changed them'
);

-- The office user unchecks it: the packer changes too.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
update public.packing_lines set packed_qty = 0 where product_id = 'pk-leg';
select is(
  (select packed_by::text || ':' || packed_qty from public.packing_lines where product_id = 'pk-leg'),
  '00000000-0000-4000-8000-0000000000a1:0',
  'an update records the new person'
);

reset role;
select * from finish();
rollback;
