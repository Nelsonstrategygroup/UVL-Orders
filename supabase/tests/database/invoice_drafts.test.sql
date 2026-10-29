-- Invoicing, stage 2 (migration 20261029000100): drafts made from the box
-- records, shorted and not-on-order lines, per case and per each, the
-- fingerprint, updating a draft (manual lines and discounts kept), and who
-- may see and change invoices.

begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d2a1', 'drafts-billing@test.local'),
  ('00000000-0000-4000-8000-00000000d2a2', 'drafts-packing@test.local'),
  ('00000000-0000-4000-8000-00000000d2a3', 'drafts-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000d2a1', 'Biller', 'billing'),
  ('00000000-0000-4000-8000-00000000d2a2', 'Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000d2a3', 'Office', 'office');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000d2c1', 'Draft Market'),
  ('00000000-0000-4000-8000-00000000d2c2', 'Draft Deli'),
  ('00000000-0000-4000-8000-00000000d2c3', 'Draft Nothing Packed');
insert into public.customer_billing (customer_id, invoice_code) values ('00000000-0000-4000-8000-00000000d2c1', 'DRMK');
insert into public.weeks (id, invoice_number) values ('2099-09-07', 99101);
insert into public.products (id, name, unit, group_name, price_unit) values
  ('dr-lb', 'Draft chops', 'lb', 'Other', 'lb'),
  ('dr-liver', 'Draft liver', 'pack', 'Other', 'lb'),
  ('dr-case', 'Draft sticks', 'case', 'Other', 'case'),
  ('dr-each', 'Draft legs', 'each', 'Other', 'each'),
  ('dr-extra', 'Draft sirloin', 'lb', 'Other', 'lb');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000d2b1', '2099-09-07', '00000000-0000-4000-8000-00000000d2c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000d2b2', '2099-09-07', '00000000-0000-4000-8000-00000000d2c2', 'ordered'),
  ('00000000-0000-4000-8000-00000000d2b3', '2099-09-07', '00000000-0000-4000-8000-00000000d2c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000d2b1', 'dr-lb', 60),
  ('00000000-0000-4000-8000-00000000d2b1', 'dr-liver', 6),
  ('00000000-0000-4000-8000-00000000d2b1', 'dr-case', 2),
  ('00000000-0000-4000-8000-00000000d2b1', 'dr-each', 4),
  ('00000000-0000-4000-8000-00000000d2b2', 'dr-each', 3),
  ('00000000-0000-4000-8000-00000000d2b3', 'dr-lb', 10);
-- Market: two boxes of chops, two of sticks, one of legs (no count typed),
-- a box of sirloin it didn't order, no liver. Deli: legs, 3 counted, no boxes.
insert into public.packing_weights (id, order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000d2e1', '00000000-0000-4000-8000-00000000d2b1', 'dr-lb', 31.25),
  ('00000000-0000-4000-8000-00000000d2e2', '00000000-0000-4000-8000-00000000d2b1', 'dr-lb', 28.4),
  ('00000000-0000-4000-8000-00000000d2e3', '00000000-0000-4000-8000-00000000d2b1', 'dr-case', 12.1),
  ('00000000-0000-4000-8000-00000000d2e4', '00000000-0000-4000-8000-00000000d2b1', 'dr-case', 12.3),
  ('00000000-0000-4000-8000-00000000d2e5', '00000000-0000-4000-8000-00000000d2b1', 'dr-each', 40.0),
  ('00000000-0000-4000-8000-00000000d2e6', '00000000-0000-4000-8000-00000000d2b1', 'dr-extra', 8.05);
insert into public.packing_lines (order_id, product_id, packed_qty) values
  ('00000000-0000-4000-8000-00000000d2b2', 'dr-each', 3);

set local role authenticated;

-- Packing can't see or make invoices.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d2a2","role":"authenticated"}';
select throws_ok($$ select public.make_invoice_drafts('2099-09-07') $$, '42501', null, 'packing can''t make drafts');

-- Billing makes the drafts.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d2a1","role":"authenticated"}';
select is(public.make_invoice_drafts('2099-09-07')::text, '2', 'a draft for each location with something packed');
select is((select count(*) from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c3')::text, '0',
  'no draft when nothing was packed');
select is((select number from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c1'), '99101-DRMK',
  'the number is the week number and the code');
select is((select number from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c2'), null,
  'no code: no number yet');
select is((select invoice_date::text from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c1'), '2099-09-08',
  'the invoice date starts as the Tuesday after packing');
select is((select status from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c1'), 'draft', 'it''s a draft');

create temp view mk as
  select l.* from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000d2c1';
grant select on mk to authenticated;

select is((select quantity::text from mk where product_id = 'dr-lb'), '59.650', 'per lb: the sum of the boxes'' weights');
select is((select boxes::text from mk where product_id = 'dr-lb'), '2', 'with the box count');
select is((select quantity::text from mk where product_id = 'dr-case'), '2.000', 'per case: one case per box');
select is((select quantity from mk where product_id = 'dr-each'), null, 'per each with no count typed: Count needed');
select is((select kind || ' ' || quantity::text from mk where product_id = 'dr-liver'), 'shorted 0.000', 'ordered, not packed: shorted at 0');
select ok((select not_on_order from mk where product_id = 'dr-extra'), 'packed but not ordered: marked not on the order');
select is((select unit_price from mk where product_id = 'dr-lb'), null, 'a draft''s packed line carries no price');
select is((select string_agg(product_id, ',' order by sort) from mk where kind = 'shorted'), 'dr-liver', 'shorted lines only for products ordered');
select is((select kind || ' ' || quantity::text || ' ' || boxes::text from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000d2c2'), 'packed 3.000 0', 'per each with a count and no boxes is billed');

-- Fingerprint: matches until a box changes.
select ok((select f.fingerprint = i.fingerprint from public.invoice_fingerprints('2099-09-07') f join public.invoices i on i.id = f.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000d2c1'), 'a new draft is up to date');

-- A manual line, and a discount, then a box is reweighed.
select throws_ok($$ insert into public.invoice_lines (invoice_id, kind, description, quantity, unit_price)
  select id, 'manual', 'Delivery', 1, 25 from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c1' $$,
  '23514', null, 'a manual line needs a note');
select lives_ok($$ insert into public.invoice_lines (invoice_id, kind, description, quantity, unit_price, note, sort)
  select id, 'manual', 'Delivery', 1, 25, 'Extra stop', 99 from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c1' $$,
  'a manual line with a note');
select throws_ok($$ update public.invoice_lines set discount_kind = 'percent', discount = 10 where product_id = 'dr-lb' $$,
  '23514', null, 'a discount needs a note');
select lives_ok($$ update public.invoice_lines set discount_kind = 'percent', discount = 10, note = 'Short date' where product_id = 'dr-lb' $$,
  'a discount with a note');

reset role;
update public.packing_weights set weight = 30.4 where id = '00000000-0000-4000-8000-00000000d2e2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d2a1","role":"authenticated"}';
select ok((select f.fingerprint <> i.fingerprint from public.invoice_fingerprints('2099-09-07') f join public.invoices i on i.id = f.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000d2c1'), 'a reweighed box puts the draft out of date');
select lives_ok($$ select public.update_invoice_draft(id) from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c1' $$,
  'update the draft');
select is((select quantity::text || ' ' || discount_kind || ' ' || note from mk where product_id = 'dr-lb'), '61.650 percent Short date',
  'the new weight, the discount kept');
select is((select count(*)::text || ' ' || max(sort)::text from mk where kind = 'manual'), '1 6', 'the manual line kept, after the packing lines');

-- Office looks but can't change.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d2a3","role":"authenticated"}';
select isnt_empty($$ select 1 from public.invoices where week_id = '2099-09-07' $$, 'office sees invoices');
update public.invoices set memo = 'x' where week_id = '2099-09-07';
reset role;
select is((select count(*)::text from public.invoices where week_id = '2099-09-07' and memo = 'x'), '0', 'office can''t change an invoice');

-- A finalized invoice's lines don't change.
update public.invoices set status = 'finalized' where customer_id = '00000000-0000-4000-8000-00000000d2c2';
select throws_ok($$ update public.invoice_lines set note = 'x' where product_id = 'dr-each'
  and invoice_id in (select id from public.invoices where customer_id = '00000000-0000-4000-8000-00000000d2c2') $$,
  '42501', null, 'a finalized invoice''s lines are locked');

select * from finish();
rollback;
