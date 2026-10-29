-- Invoicing, stage 1 (migration 20261028000100): week invoice numbers,
-- customer billing details, invoice settings, price units, prices, and who
-- may see and change them.

begin;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000b1a1', 'inv-billing@test.local'),
  ('00000000-0000-4000-8000-00000000b1a2', 'inv-packing@test.local'),
  ('00000000-0000-4000-8000-00000000b1a3', 'inv-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000b1a1', 'Biller', 'billing'),
  ('00000000-0000-4000-8000-00000000b1a2', 'Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000b1a3', 'Office', 'office');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000b1c1', 'Inv Market'),
  ('00000000-0000-4000-8000-00000000b1c2', 'Inv Deli');
insert into public.weeks (id) values ('2099-08-03'), ('2099-08-10');
insert into public.products (id, name, unit, group_name) values ('inv-prod', 'Inv product', 'lb', 'Other');

select is((select price_unit from public.products where id = 'inv-prod'), 'lb', 'a new product is priced per lb');
select is((select default_terms_days from public.invoice_settings)::text, '15', 'default terms are Net 15');
select is((select business_address from public.invoice_settings), E'PO Box 1120\nRiddle, OR 97469', 'business address starts as the PO box');
select throws_ok($$ insert into public.customer_billing (customer_id, invoice_code) values ('00000000-0000-4000-8000-00000000b1c1', 'ab') $$,
  '23514', null, 'a code is 3 to 5 capitals or digits');
select throws_ok($$ update public.products set price_unit = 'dozen' where id = 'inv-prod' $$,
  '23514', null, 'price unit is lb, case or each');

set local role authenticated;

-- Billing: sets numbers, codes, settings and prices.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b1a1","role":"authenticated"}';
select is(public.perm('invoices'), 2::smallint, 'billing changes invoices');
select is(public.perm('prices'), 2::smallint, 'billing changes prices');
select is(public.perm('setup'), 1::smallint, 'billing can look at Setup');
select is(public.perm('cutsheet'), 0::smallint, 'billing has no cut sheet');
select lives_ok($$ select public.set_week_invoice_number('2099-08-03', 99001) $$, 'billing sets a week''s invoice number');
select is((select invoice_number from public.weeks where id = '2099-08-03')::text, '99001', 'the number is saved on the week');
select throws_ok($$ select public.set_week_invoice_number('2099-08-10', 99001) $$, '23505', null, 'two weeks can''t share a number');
select lives_ok($$ select public.set_week_invoice_number('2099-08-03', 99002) $$, 'a week''s number can be changed');
select lives_ok($$ insert into public.customer_billing (customer_id, invoice_code, terms_days) values ('00000000-0000-4000-8000-00000000b1c1', 'INVM', 30) $$,
  'billing gives a location a code and terms');
select throws_ok($$ insert into public.customer_billing (customer_id, invoice_code) values ('00000000-0000-4000-8000-00000000b1c2', 'INVM') $$,
  '23505', null, 'two locations can''t share a code');
select lives_ok($$ update public.customer_billing set invoice_code = 'INVMK' where customer_id = '00000000-0000-4000-8000-00000000b1c1' $$,
  'a code can be changed');
select lives_ok($$ update public.invoice_settings set remit_to = 'Remit test' $$, 'billing changes the remit-to');
select lives_ok($$ insert into public.prices (product_id, price, effective_from) values ('inv-prod', 9.5, '2099-08-01') $$, 'billing adds a default price');
select throws_ok($$ insert into public.prices (product_id, price, effective_from) values ('inv-prod', 9.75, '2099-08-01') $$,
  '23505', null, 'one default price per product per day');
select lives_ok($$ insert into public.prices (product_id, customer_id, price, effective_from) values ('inv-prod', '00000000-0000-4000-8000-00000000b1c1', 9.25, '2099-08-01') $$,
  'a customer price on the same day as the default');

-- Packing never sees prices or billing details.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b1a2","role":"authenticated"}';
select is_empty($$ select 1 from public.prices $$, 'packing cannot see prices');

-- Office can look at prices but not change them.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b1a3","role":"authenticated"}';
select throws_ok($$ insert into public.prices (product_id, price, effective_from) values ('inv-prod', 1, '2099-09-01') $$,
  '42501', null, 'office cannot add prices');

select * from finish();
rollback;
