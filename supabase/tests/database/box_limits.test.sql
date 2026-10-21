-- SPEC 12: box types, box limits from Kathy's sheet, the cap, and who may change them.

begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000006b1', 'bx-packer@test.local'),
  ('00000000-0000-4000-8000-0000000006b3', 'bx-admin@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000006b1', 'Chris', 'packing'),
  ('00000000-0000-4000-8000-0000000006b3', 'Admin', 'admin');

select is(
  (select string_agg(name, ',' order by size_rank) from public.box_types),
  'MVM,Roll Stock,Jerky,White,Baby', 'five box types, largest first');
select is((select box_cap_lb::int from public.app_settings), 45, 'the box cap starts at 45 lb');

-- Seeded products that carry Kathy's names get her limits.
select is(
  (select max_count::int from public.product_box_limits l join public.products p on p.id = l.product_id
   where p.name = 'French Rack' and l.box_type_id = 'mvm'),
  18, 'French Rack: 18 in an MVM box');
select is(
  (select status from public.product_box_limits l join public.products p on p.id = l.product_id
   where p.name = 'French Rack' and l.box_type_id = 'white'),
  'does_not_fit', 'French Rack never goes in a White box');
select is(
  (select max_lb::int from public.product_box_limits l join public.products p on p.id = l.product_id
   where p.name = 'Le Trim' and l.box_type_id = 'mvm'),
  40, 'Le Trim: 40 lb in an MVM box');
select throws_ok(
  $$ insert into public.product_box_limits (product_id, box_type_id, status) values ('cp-le-trim', 'baby', 'ok')
     on conflict (product_id, box_type_id) do update set status = 'ok', max_count = null, max_lb = null $$,
  '23514', null, 'an "ok" limit needs a count or a weight');
select is((select public.load_box_limits()), 0, 'loading again adds nothing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}';
update public.product_box_limits set max_count = 99 where box_type_id = 'mvm' and product_id = 'cp-french-rack';
select throws_ok(
  $$ insert into public.box_types (id, name, size_rank) values ('crate', 'Crate', 9) $$,
  '42501', null, 'a packer cannot add box types');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000006b3","role":"authenticated"}';
select is((select max_count::int from public.product_box_limits where box_type_id = 'mvm' and product_id = 'cp-french-rack'), 18,
  'a packer''s change to a box limit does nothing');
update public.product_box_limits set max_count = 17 where box_type_id = 'mvm' and product_id = 'cp-french-rack';
select is((select max_count::int from public.product_box_limits where box_type_id = 'mvm' and product_id = 'cp-french-rack'), 17,
  'an admin can change a box limit');

reset role;
select * from finish();
rollback;
