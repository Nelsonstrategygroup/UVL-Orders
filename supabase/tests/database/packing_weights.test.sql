-- Stage 3: packing by weight, line marks, and pallet groups.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'pw-packer@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'pw-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000b3', 'pw-admin@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000b1', 'Chris', 'packing'),
  ('00000000-0000-4000-8000-0000000000b2', 'Viewer', 'viewer'),
  ('00000000-0000-4000-8000-0000000000b3', 'Admin', 'admin');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'PW Market');
insert into public.weeks (id) values ('2099-08-03');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000000d1', '2099-08-03', '00000000-0000-4000-8000-0000000000c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty)
  select '00000000-0000-4000-8000-0000000000d1', id, 20 from public.products where id = 'cp-le-trim';

set local role authenticated;

-- Chris packs Le Trim as three cases, two in their own boxes and one mixed.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ insert into public.packing_weights (order_id, product_id, weight, box_no) values
       ('00000000-0000-4000-8000-0000000000d1', 'cp-le-trim', 9.8, 1),
       ('00000000-0000-4000-8000-0000000000d1', 'cp-le-trim', 10.4, 2) $$,
  'a packer records weights in boxes');
select is(
  (select sum(weight) || ':' || count(distinct box_no) || ':' || bool_and(created_by = '00000000-0000-4000-8000-0000000000b1')
   from public.packing_weights where order_id = '00000000-0000-4000-8000-0000000000d1'),
  '20.2:2:true', 'the line adds up, and each weight records who weighed it');
select lives_ok(
  $$ insert into public.packing_lines (order_id, product_id, shorted, flagged, flag_note)
     values ('00000000-0000-4000-8000-0000000000d1', 'cp-le-trim', false, true, 'Check the cap') $$,
  'a line can be flagged with a note, with no count');
select throws_ok(
  $$ insert into public.packing_weights (order_id, product_id, weight) values ('00000000-0000-4000-8000-0000000000d1', 'cp-le-trim', 0) $$,
  '23514', null, 'a weight must be more than zero');
select throws_ok(
  $$ insert into public.pallet_groups (name) values ('Bellingham') $$,
  '42501', null, 'a packer cannot set up pallet groups');

-- A viewer can look but not weigh.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select isnt_empty($$ select 1 from public.packing_weights $$, 'a viewer sees the weights');
select throws_ok(
  $$ insert into public.packing_weights (order_id, product_id, weight) values ('00000000-0000-4000-8000-0000000000d1', 'cp-le-trim', 5) $$,
  '42501', null, 'a viewer cannot record a weight');

-- An admin sets up pallet groups.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}';
select lives_ok(
  $$ with g as (insert into public.pallet_groups (name, sort) values ('Bellingham Stores', 1) returning id)
     update public.customers set pallet_group_id = (select id from g), pallet_spot = 'Left half'
     where id = '00000000-0000-4000-8000-0000000000c1' $$,
  'an admin puts a customer in a pallet group');

reset role;
select * from finish();
rollback;
