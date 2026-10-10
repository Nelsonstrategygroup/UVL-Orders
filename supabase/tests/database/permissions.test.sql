-- Permissions: role defaults, per-person overrides, and the fixed rules.

begin;
select plan(24);

insert into public.parts (id, name, per_lamb, unit) values ('perm-part', 'Perm part', 1, 'each') on conflict do nothing;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'perm-office@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'perm-packing@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'perm-viewer@test.local'),
  ('00000000-0000-4000-8000-0000000000a4', 'perm-lead@test.local'),
  ('00000000-0000-4000-8000-0000000000a5', 'perm-admin@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-0000000000a2', 'Packer', 'packing'),
  ('00000000-0000-4000-8000-0000000000a3', 'Viewer', 'viewer'),
  ('00000000-0000-4000-8000-0000000000a4', 'Packing lead', 'packing'),
  ('00000000-0000-4000-8000-0000000000a5', 'Admin', 'admin');
-- The packing lead may see orders and the cut sheet; someone tried to give
-- the office user Setup change, and the admin an Off.
insert into public.user_permissions (user_id, area, level) values
  ('00000000-0000-4000-8000-0000000000a4', 'orders', 1),
  ('00000000-0000-4000-8000-0000000000a4', 'cutsheet', 1),
  ('00000000-0000-4000-8000-0000000000a1', 'setup', 2),
  ('00000000-0000-4000-8000-0000000000a5', 'orders', 0);
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Perm Market');
insert into public.weeks (id) values ('2099-07-06');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000000d1', '2099-07-06', '00000000-0000-4000-8000-0000000000c1', 'ordered');
insert into public.cut_sheets (week_id) values ('2099-07-06');
insert into public.cut_sets (id, week_id, name, lambs) values ('00000000-0000-4000-8000-0000000000e1', '2099-07-06', 'Perm set', 2);
insert into public.contact_log (customer_id, kind, summary, created_by)
  values ('00000000-0000-4000-8000-0000000000c1', 'call', 'Perm note', '00000000-0000-4000-8000-0000000000a1');

select is((select count(*)::int from public.role_permissions), 33, 'three roles have a default for each of the 11 areas');

set local role authenticated;

-- Office: what it had before. Setup stays View even with an override.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(public.perm('orders'), 2::smallint, 'office changes orders');
select is(public.perm('setup'), 1::smallint, 'office sees Setup but cannot change it, even with an override');
update public.parts set per_lamb = 9 where id = 'perm-part';
select is((select per_lamb from public.parts where id = 'perm-part'), 1::numeric, 'office cannot change Setup numbers');
select is((select count(*)::int from jsonb_object_keys(public.my_permissions())), 11, 'my_permissions lists every area');

-- Packing: the packing screen only.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is_empty($$ select 1 from public.cut_sets $$, 'packing cannot see the cut sheet');
select is_empty($$ select 1 from public.contact_log $$, 'packing cannot see call notes');
select isnt_empty($$ select 1 from public.orders $$, 'packing can see the orders it packs');
select lives_ok(
  $$ insert into public.packing_lines (order_id, product_id, packed_qty)
     select '00000000-0000-4000-8000-0000000000d1', id, 1 from public.products limit 1 $$,
  'packing can pack');
select throws_ok(
  $$ select public.set_order('2099-07-06', '00000000-0000-4000-8000-0000000000c1', 'none') $$,
  '42501', null, 'packing cannot change orders');

-- Packing lead: packing plus a view of orders and the cut sheet.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select isnt_empty($$ select 1 from public.cut_sets $$, 'an override lets a packer see the cut sheet');
select throws_ok(
  $$ select public.fill_cut_set('00000000-0000-4000-8000-0000000000e1') $$,
  '42501', null, 'but not change it');
select throws_ok(
  $$ select public.set_order('2099-07-06', '00000000-0000-4000-8000-0000000000c1', 'none') $$,
  '42501', null, 'seeing orders is not changing them');
update public.cut_sets set lambs = 99 where id = '00000000-0000-4000-8000-0000000000e1';
select is((select lambs from public.cut_sets where id = '00000000-0000-4000-8000-0000000000e1'), 2,
  'a direct change to the cut sheet does nothing');
select is_empty($$ select 1 from public.contact_log $$, 'call notes stay hidden');

-- Viewer: sees everything but Setup; changes nothing.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select isnt_empty($$ select 1 from public.contact_log $$, 'a viewer can read call notes');
select isnt_empty($$ select 1 from public.cut_sets $$, 'a viewer can read the cut sheet');
select is(public.perm('setup'), 0::smallint, 'a viewer does not see Setup');
select throws_ok(
  $$ insert into public.contact_log (customer_id, kind, summary) values ('00000000-0000-4000-8000-0000000000c1', 'note', 'x') $$,
  '42501', null, 'a viewer cannot log a call');
select throws_ok(
  $$ select public.set_order('2099-07-06', '00000000-0000-4000-8000-0000000000c1', 'none') $$,
  '42501', null, 'a viewer cannot change orders');
select throws_ok(
  $$ insert into public.user_permissions (user_id, area, level) values ('00000000-0000-4000-8000-0000000000a3', 'orders', 2) $$,
  '42501', null, 'nobody but an admin can grant access');
update public.role_permissions set level = 2 where role = 'viewer';
select is((select max(level)::int from public.role_permissions where role = 'viewer'), 1, 'nor change role defaults');

-- Admin: always everything, whatever an override says.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a5","role":"authenticated"}';
select is(public.perm('orders'), 2::smallint, 'an admin keeps Change even with an Off override');
select is(public.perm('setup'), 2::smallint, 'only admins change Setup');

reset role;
select * from finish();
rollback;
