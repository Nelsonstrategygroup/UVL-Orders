-- Customer products (change requests 2026-10): the starting list, order lines
-- with units, and filling the cut sheet from pounds.

begin;
select plan(13);

-- The starting list ran once, after the catalog was loaded.
select is(
  (select count(*)::int from public.products where id like 'cp-%' and active), 22,
  'the 22 starting customer products are on');
select is(
  (select count(*)::int from public.products where id not like 'cp-%' and active and created_at < now()), 0,
  'the old Mohawk-wording products are off');
select is(
  (select count(*)::int from public.products where id like 'cp-%' and confirmed), 0,
  'every starting value is marked not confirmed');
select is(public.seed_customer_products(), 'already done', 'running it again changes nothing');
select is(
  (select string_agg(id, ',' order by id) from public.parts where not drives_count), 'denver,hshank,neck,trim',
  'byproduct parts (and hind shanks, for now) do not drive the lamb count');
select is(
  (select units_per_cut from public.product_cut_specs pc join public.cut_specs s on s.id = pc.cut_spec_id
   where pc.product_id = 'cp-chops' and s.text like 'Short Loins to 1 1/4 inch chops%'), 2.5::numeric,
  'Chops link to the 1 1/4 inch chop line at 2.5 lb per short loin');

-- Pounds and pieces.
select is(public.qty_in_product_unit(10, 'lb', 'pack', 5), 2::numeric, '10 lb of 5 lb packs is 2 packs');
select is(public.qty_in_product_unit(3, 'each', 'lb', null), 0::numeric, 'without a piece weight, it cannot be converted');

-- Saving an order with a unit on a line.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'cp-kathy@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-0000000000e1', 'Kathy', 'office');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000e2', 'CP Test Market');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}';

select public.set_order('2099-05-04', '00000000-0000-4000-8000-0000000000e2', null, null,
  '{"cp-chops": 16, "cp-bls-shoulder": 20, "cp-short-loin": 3}', '{"cp-bls-shoulder": "lb", "cp-chops": "lb"}');
select is(
  (select string_agg(l.product_id || '=' || l.qty || ':' || coalesce(l.unit, '-'), ',' order by l.product_id)
   from public.order_lines l join public.orders o on o.id = l.order_id
   where o.customer_id = '00000000-0000-4000-8000-0000000000e2'),
  'cp-bls-shoulder=20:lb,cp-chops=16:-,cp-short-loin=3:-',
  'a line keeps its unit only when it differs from the product''s own');

-- Saving without units (the grid) keeps each line's unit.
select public.set_order('2099-05-04', '00000000-0000-4000-8000-0000000000e2', null, null,
  '{"cp-chops": 16, "cp-bls-shoulder": 24, "cp-short-loin": 3}');
select is(
  (select l.qty || ':' || coalesce(l.unit, '-') from public.order_lines l join public.orders o on o.id = l.order_id
   where o.customer_id = '00000000-0000-4000-8000-0000000000e2' and l.product_id = 'cp-bls-shoulder'),
  '24:lb', 'changing a quantity without units keeps the line in pounds');

-- Fill a set: 16 lb of chops at 2.5 lb per loin is 6.4, so 7 chop lines;
-- 3 short loins is 3 lines.
insert into public.cut_sheets (week_id) values ('2099-05-04');
insert into public.cut_sets (id, week_id, name, lambs) values ('00000000-0000-4000-8000-0000000000e3', '2099-05-04', 'Test set', 4);
insert into public.cut_set_customers (set_id, customer_id) values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000e2');
select public.fill_cut_set('00000000-0000-4000-8000-0000000000e3');
select is(
  (select l.qty from public.cut_set_lines l join public.cut_specs s on s.id = l.cut_spec_id
   where l.set_id = '00000000-0000-4000-8000-0000000000e3' and s.text like 'Short Loins to 1 1/4 inch chops%'),
  7::numeric, 'pounds of chops become whole short loins, rounded up');
select is(
  (select l.qty from public.cut_set_lines l join public.cut_specs s on s.id = l.cut_spec_id
   where l.set_id = '00000000-0000-4000-8000-0000000000e3' and s.text = 'Shortloins - NSM Spec lean trim::1 PK,'),
  3::numeric, 'short loins go on their own line');

-- A new instruction from the cut sheet doesn't add to the order list.
create temp table spec on commit drop as select public.add_cut_spec('CP test instruction', 'leg') as id;
select is(
  (select count(*)::int from public.products where cut_spec_id = (select id from spec)), 0,
  'a new Mohawk instruction does not become an orderable product');

reset role;
select * from finish();
rollback;
