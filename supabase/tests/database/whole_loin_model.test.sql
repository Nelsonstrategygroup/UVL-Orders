-- Carcass balance fix, step 1 (10/15/26): the whole loin part, racks and
-- short loins cut from it, and the two new products (off until step 2).

begin;
select plan(7);

select is((select per_lamb::int from public.parts where id = 'wholeloin'), 2, 'one lamb gives 2 whole loins');
select ok((select drives_count from public.parts where id = 'wholeloin'), 'whole loins can set the count');
select is(
  (select string_agg(id, ',' order by id) from public.parts where made_from = 'wholeloin'),
  'loin,rack', 'racks and short loins are cut from whole loins');
select throws_ok(
  $$ update public.parts set made_from = 'wholeloin' where id = 'wholeloin' $$,
  '23514', null, 'a part cannot be cut from itself');
select ok(
  (select carcass from public.products where id = 'cp-carcass-lamb'),
  'Carcass Lamb is a product marked as an uncut lamb');
select is(
  (select count(*)::int from public.product_part_uses where product_id = 'cp-carcass-lamb'), 0,
  'a carcass lamb uses no parts');
select is(
  (select string_agg(part_id || '=' || qty, ',') from public.product_part_uses where product_id = 'cp-chop-ready-rack'),
  'rack=1', 'Chop Ready Rack uses one rack');

select * from finish();
rollback;
