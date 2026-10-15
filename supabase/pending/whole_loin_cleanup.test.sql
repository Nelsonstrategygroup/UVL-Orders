-- Carcass balance fix (10/15/26): the whole loin part, racks and short loins
-- cut from it, what sets the count, and the two new products.

begin;
select plan(8);

select is((select per_lamb::int from public.parts where id = 'wholeloin'), 2, 'one lamb gives 2 whole loins');
select is(
  (select string_agg(id, ',' order by id) from public.parts where made_from = 'wholeloin'),
  'loin,rack', 'racks and short loins are cut from whole loins');
select is(
  (select string_agg(id || '=' || drives_count, ',' order by id) from public.parts
   where id in ('leg', 'shoulder', 'wholeloin', 'rack', 'loin', 'fshank', 'hshank')),
  'fshank=false,hshank=false,leg=true,loin=false,rack=false,shoulder=true,wholeloin=true',
  'only legs, shoulders and whole loins set the count');
select throws_ok(
  $$ update public.parts set made_from = 'wholeloin' where id = 'wholeloin' $$,
  '23514', null, 'a part cannot be cut from itself');
select ok(
  (select carcass and active from public.products where id = 'cp-carcass-lamb'),
  'Carcass Lamb is a product, on, marked as an uncut lamb');
select is(
  (select count(*)::int from public.product_part_uses where product_id = 'cp-carcass-lamb'), 0,
  'a carcass lamb uses no parts');
select is(
  (select string_agg(part_id || '=' || qty, ',') from public.product_part_uses where product_id = 'cp-chop-ready-rack'),
  'rack=1', 'Chop Ready Rack uses one rack');
select is(
  (select count(*)::int from public.parts where id in ('carcass-lamb-vzg5', 'whole-loins-ooky')), 0,
  'the two parts added by mistake are gone');

select * from finish();
rollback;
