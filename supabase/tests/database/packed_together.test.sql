-- Products packed together (migration 20261029000200): one box of any of
-- them is the order for all; one invoice line, weight only, priced under the
-- group's first product, with the counted packs under it.

begin;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000e3a1', 'together-billing@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-00000000e3a1', 'Biller', 'billing');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000e3c1', 'Together Store'),
  ('00000000-0000-4000-8000-00000000e3c2', 'Together Nothing');
insert into public.weeks (id) values ('2099-10-05');
insert into public.products (id, name, unit, group_name, price_unit, sort, packed_with) values
  ('tg-heart', 'TG Heart', 'pack', 'Other', 'lb', 9001, 'TG Organs'),
  ('tg-liver', 'TG Liver', 'pack', 'Other', 'lb', 9002, 'TG Organs'),
  ('tg-kidney', 'TG Kidney', 'pack', 'Other', 'lb', 9003, 'TG Organs'),
  ('tg-chops', 'TG Chops', 'lb', 'Other', 'lb', 9000, '');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000e3b1', '2099-10-05', '00000000-0000-4000-8000-00000000e3c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000e3b2', '2099-10-05', '00000000-0000-4000-8000-00000000e3c2', 'ordered');
-- Store: ordered Heart and Liver and chops; one box labeled Kidney went out.
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-heart', 2),
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-liver', 5),
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-chops', 20),
  ('00000000-0000-4000-8000-00000000e3b2', 'tg-heart', 3),
  ('00000000-0000-4000-8000-00000000e3b2', 'tg-chops', 10);
insert into public.packing_weights (order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-kidney', 10.95),
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-chops', 21.5),
  ('00000000-0000-4000-8000-00000000e3b2', 'tg-chops', 9.75);
insert into public.packing_lines (order_id, product_id, packed_qty) values
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-heart', 2),
  ('00000000-0000-4000-8000-00000000e3b1', 'tg-liver', 5);

select is(public.pack_group_product('tg-kidney'), 'tg-heart', 'a group is priced under its first product');
select is(public.pack_group_product('tg-chops'), 'tg-chops', 'a product on its own is its own');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e3a1","role":"authenticated"}';
select is(public.make_invoice_drafts('2099-10-05')::text, '2', 'drafts made');

reset role;
create temp view tg as
  select c.name as store, l.* from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id join public.customers c on c.id = i.customer_id
  where i.week_id = '2099-10-05';

select is((select count(*)::text from tg where store = 'Together Store' and product_id like 'tg-%' and product_id <> 'tg-chops'), '1',
  'the organs are one line');
select is((select kind || ' | ' || description || ' | ' || boxes || ' | ' || quantity::text || ' | ' || detail from tg
  where store = 'Together Store' and product_id = 'tg-heart'),
  'packed | TG Heart, TG Liver, TG Kidney | 1 | 10.950 | 2 TG Heart, 5 TG Liver', 'billed by the box''s weight, with the packs counted');
select ok((select ordered_qty is null and not not_on_order from tg where store = 'Together Store' and product_id = 'tg-heart'),
  'weight only, and on the order (Heart was ordered)');
select is((select string_agg(kind, ',') from tg where store = 'Together Store' and kind = 'shorted'), null, 'Heart and Liver aren''t Not shipped');
select is((select kind || ' | ' || description from tg where store = 'Together Nothing' and product_id = 'tg-heart'),
  'shorted | TG Heart', 'no organ box: Not shipped, naming what was ordered');

-- Taking a product out of the group puts the draft out of date.
update public.products set packed_with = '' where id = 'tg-kidney';
select ok((select bool_or(f.fingerprint <> i.fingerprint) from public.invoice_fingerprints('2099-10-05') f
  join public.invoices i on i.id = f.invoice_id where i.customer_id = '00000000-0000-4000-8000-00000000e3c1'),
  'changing who''s packed together puts the draft out of date');

select * from finish();
rollback;
