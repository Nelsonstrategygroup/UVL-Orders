-- Freight income (migration 20261120000100): none unless set; a chain's
-- setting covers its stores; finalizing adds one Freight line (pallets,
-- boxes, lb or a delivery × the rate); reopening clears it.

begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f9a1', 'fi-admin@test.local'),
  ('00000000-0000-4000-8000-00000000f9a2', 'fi-billing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f9a1', 'FI Boss', 'admin'),
  ('00000000-0000-4000-8000-00000000f9a2', 'FI Biller', 'billing');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000f9c1', 'FI Solo'),
  ('00000000-0000-4000-8000-00000000f9c2', 'FI Chain');
insert into public.customers (id, name, parent_customer_id) values
  ('00000000-0000-4000-8000-00000000f9c3', 'FI Store', '00000000-0000-4000-8000-00000000f9c2');
insert into public.customer_billing (customer_id, invoice_code) values
  ('00000000-0000-4000-8000-00000000f9c1', 'FIS'),
  ('00000000-0000-4000-8000-00000000f9c3', 'FIT');
insert into public.weeks (id, invoice_number) values ('2099-12-21', 99801);
insert into public.products (id, name, unit, group_name, price_unit) values ('fi-chops', 'FI chops', 'lb', 'Other', 'lb');
insert into public.prices (product_id, price, effective_from) values ('fi-chops', 10, '2099-01-01');
insert into public.pallets (id, week_id, ship_date, number) values
  ('00000000-0000-4000-8000-00000000f9e1', '2099-12-21', '2099-12-22', 901),
  ('00000000-0000-4000-8000-00000000f9e2', '2099-12-21', '2099-12-22', 902);
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f9b1', '2099-12-21', '00000000-0000-4000-8000-00000000f9c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000f9b2', '2099-12-21', '00000000-0000-4000-8000-00000000f9c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000f9b1', 'fi-chops', 30),
  ('00000000-0000-4000-8000-00000000f9b2', 'fi-chops', 30);
insert into public.packing_weights (order_id, product_id, weight, pallet_id) values
  ('00000000-0000-4000-8000-00000000f9b1', 'fi-chops', 10, '00000000-0000-4000-8000-00000000f9e1'),
  ('00000000-0000-4000-8000-00000000f9b1', 'fi-chops', 10.5, '00000000-0000-4000-8000-00000000f9e1'),
  ('00000000-0000-4000-8000-00000000f9b2', 'fi-chops', 12, '00000000-0000-4000-8000-00000000f9e1'),
  ('00000000-0000-4000-8000-00000000f9b2', 'fi-chops', 8, '00000000-0000-4000-8000-00000000f9e2');

select is((select count(*)::int from public.freight_on('00000000-0000-4000-8000-00000000f9c1', '2099-12-22')), 0, 'no freight unless set');
insert into public.freight_charges (customer_id, method, amount, effective_from) values
  ('00000000-0000-4000-8000-00000000f9c1', 'per_lb', 0.25, '2099-01-01'),
  ('00000000-0000-4000-8000-00000000f9c2', 'per_pallet', 30, '2099-01-01');
select is((select method || ' ' || amount from public.freight_on('00000000-0000-4000-8000-00000000f9c3', '2099-12-22')), 'per_pallet 30.0000',
  'a chain''s setting covers its stores');
select throws_ok($$ insert into public.freight_charges (customer_id, method, amount, effective_from)
  values ('00000000-0000-4000-8000-00000000f9c1', 'per_mile', 1, '2099-02-01') $$, '23514', null, 'methods are from the list');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f9a2","role":"authenticated"}';
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.week_id = '2099-12-21' and l.kind = 'freight'), 0, 'a draft stores no freight line');
select lives_ok($$ select public.finalize_invoice(id) from public.invoices where week_id = '2099-12-21' $$, 'billing finalizes both');
select is((select l.description || ' ' || l.quantity::text || ' ' || l.price_unit || ' x ' || l.unit_price::text
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f9c1' and l.kind = 'freight'),
  'Freight 20.500 lb x 0.2500', 'per lb: the boxes'' weight');
select is((select total from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f9c1' and week_id = '2099-12-21'),
  210.13, '20.5 lb × $10.00 + 20.5 × $0.25 = $205.00 + $5.13');
select is((select l.quantity::text || ' ' || l.price_unit || ' x ' || l.unit_price::text
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f9c3' and l.kind = 'freight'),
  '2.000 each x 30.0000', 'per pallet: the two pallets carrying the store''s boxes');
select is((select max(sort) from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f9c3' and l.kind = 'freight'), 100000, 'freight is the last line');

-- Reopened: a live draft again, with no stored freight line; finalized again, one line.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f9a1","role":"authenticated"}';
select lives_ok($$ select public.reopen_invoice(id) from public.invoices
  where week_id = '2099-12-21' and customer_id = '00000000-0000-4000-8000-00000000f9c1' $$, 'an admin reopens it');
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f9c1' and l.kind = 'freight'), 0, 'the reopened draft has no stored freight line');
select public.finalize_invoice(id) from public.invoices where week_id = '2099-12-21' and customer_id = '00000000-0000-4000-8000-00000000f9c1';
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f9c1' and l.kind = 'freight'), 1, 'finalized again: one freight line');

select * from finish();
rollback;
