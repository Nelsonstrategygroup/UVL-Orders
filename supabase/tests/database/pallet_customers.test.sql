-- Plan pallets for the week (10/26/26): a packer puts stores on a planned
-- pallet; a viewer can't.

begin;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000009b1', 'pc-packer@test.local'),
  ('00000000-0000-4000-8000-0000000009b2', 'pc-viewer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000009b1', 'Chris', 'packing'),
  ('00000000-0000-4000-8000-0000000009b2', 'Viewer', 'viewer');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000009c1', 'PC Store'), ('00000000-0000-4000-8000-0000000009c2', 'PC Store 2');
insert into public.weeks (id) values ('2099-11-09');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000009b1","role":"authenticated"}';
select is(
  (select public.start_pallet('{"id":"00000000-0000-4000-8000-0000000009e1","week_id":"2099-11-09","tag":"P2",
     "ship_to_customer_id":"00000000-0000-4000-8000-0000000009c1","status":"planned"}'::jsonb) ->> 'status'),
  'saved', 'a packer plans a pallet ahead of time');
select is((select status from public.pallets where id = '00000000-0000-4000-8000-0000000009e1'), 'planned', 'it starts as planned');
select lives_ok(
  $$ insert into public.pallet_customers (pallet_id, customer_id) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c1') $$,
  'and puts a store on it');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000009b2","role":"authenticated"}';
select throws_ok(
  $$ insert into public.pallet_customers (pallet_id, customer_id) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c2') $$,
  '42501', null, 'a viewer can''t change the plan');

select * from finish();
rollback;
