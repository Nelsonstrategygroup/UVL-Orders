-- SPEC 12.4: shanks are ordered in packs of 2; the balance and Mohawk's cut
-- sheet still count single shanks.

begin;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000007a1', 'sh-office@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-0000000007a1', 'Office', 'office');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000007c1', 'SH Market');
insert into public.weeks (id) values ('2099-04-06');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000007d1', '2099-04-06', '00000000-0000-4000-8000-0000000007c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty)
  values ('00000000-0000-4000-8000-0000000007d1', 'cp-hind-shanks', 10);

select is(
  (select unit || ':' || pieces_per_pack from public.products where id = 'cp-hind-shanks'),
  'pack:2', 'Hind Shanks are ordered in packs of 2');
select is(
  (select qty::int from public.product_part_uses where product_id = 'cp-hind-shanks' and part_id = 'hshank'),
  2, 'one pack uses 2 hind shanks in the carcass balance');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}';
select public.start_cut_sheet('2099-04-06', null);
insert into public.cut_set_customers (set_id, customer_id)
select id, '00000000-0000-4000-8000-0000000007c1' from public.cut_sets where week_id = '2099-04-06';
select public.fill_cut_set((select id from public.cut_sets where week_id = '2099-04-06'));

select is(
  (select l.qty::int from public.cut_set_lines l join public.cut_sets s on s.id = l.set_id
   where s.week_id = '2099-04-06' and l.cut_spec_id = 's28'),
  20, '10 packs go on the cut sheet as 20 hind shanks');
select is(
  (select qty::int from public.order_lines where order_id = '00000000-0000-4000-8000-0000000007d1'),
  10, 'the order still says 10 (packs)');

reset role;
select * from finish();
rollback;
