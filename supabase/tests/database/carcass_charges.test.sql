-- Carcass charges (migration 20261115000100): a Mohawk charge per carcass on
-- its own line when an invoice is finalized; none where it's 0 (a chain's
-- stores); a reopened draft has no stored charge line.

begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f1a1', 'cc-admin@test.local'),
  ('00000000-0000-4000-8000-00000000f1a2', 'cc-billing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f1a1', 'CC Boss', 'admin'),
  ('00000000-0000-4000-8000-00000000f1a2', 'CC Biller', 'billing');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000f1c1', 'CC Solo'),
  ('00000000-0000-4000-8000-00000000f1c2', 'CC Chain');
insert into public.customers (id, name, parent_customer_id) values
  ('00000000-0000-4000-8000-00000000f1c3', 'CC Store', '00000000-0000-4000-8000-00000000f1c2');
insert into public.customer_billing (customer_id, invoice_code) values
  ('00000000-0000-4000-8000-00000000f1c1', 'CCS'),
  ('00000000-0000-4000-8000-00000000f1c3', 'CCT');
insert into public.weeks (id, invoice_number) values ('2099-12-14', 99501);
insert into public.products (id, name, unit, group_name, price_unit, carcass) values
  ('cc-carcass', 'CC Carcass', 'each', 'Whole lambs', 'lb', true);
insert into public.prices (product_id, price, effective_from) values ('cc-carcass', 6, '2099-01-01');
insert into public.carcass_charges (product_id, customer_id, name, amount, effective_from) values
  ('cc-carcass', null, 'Mohawk charge, shrouded carcass', 40, '2099-01-01'),
  ('cc-carcass', '00000000-0000-4000-8000-00000000f1c2', 'Mohawk charge, shrouded carcass', 0, '2099-01-01');

select is((select amount from public.charge_on('cc-carcass', '00000000-0000-4000-8000-00000000f1c1', '2099-12-15')), 40.00,
  'the default charge');
select is((select amount from public.charge_on('cc-carcass', '00000000-0000-4000-8000-00000000f1c3', '2099-12-15')), 0.00,
  'a chain''s store gets the chain''s charge (0)');
select is((select count(*)::int from public.charge_on('cc-carcass', '00000000-0000-4000-8000-00000000f1c1', '2098-12-15')), 0,
  'no charge before it starts');
select throws_ok($$ insert into public.carcass_charges (product_id, name, amount, effective_from)
  values ('cc-carcass', 'Again', 50, '2099-01-01') $$, '23505', null, 'one default charge per product per day');

insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f1b1', '2099-12-14', '00000000-0000-4000-8000-00000000f1c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000f1b2', '2099-12-14', '00000000-0000-4000-8000-00000000f1c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000f1b1', 'cc-carcass', 1),
  ('00000000-0000-4000-8000-00000000f1b2', 'cc-carcass', 1);
insert into public.packing_weights (order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000f1b1', 'cc-carcass', 62),
  ('00000000-0000-4000-8000-00000000f1b2', 'cc-carcass', 62);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f1a2","role":"authenticated"}';
select is(public.sync_invoice_drafts('2099-12-14')::text, '2', 'two drafts');
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.week_id = '2099-12-14' and l.kind = 'charge'), 0, 'a draft stores no charge line');
select lives_ok($$ select public.finalize_invoice(id) from public.invoices
  where week_id = '2099-12-14' and customer_id = '00000000-0000-4000-8000-00000000f1c1' $$, 'billing finalizes');
select is((select l.description || ' ' || l.quantity::text || ' x ' || l.unit_price::text
  from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f1c1' and l.kind = 'charge'),
  'Mohawk charge, shrouded carcass 1.000 x 40.0000', 'one carcass x $40 on its own line');
select is((select total from public.invoices where week_id = '2099-12-14' and customer_id = '00000000-0000-4000-8000-00000000f1c1'),
  412.00, '62 lb x $6.00 + $40.00 = $412.00');
select lives_ok($$ select public.finalize_invoice(id) from public.invoices
  where week_id = '2099-12-14' and customer_id = '00000000-0000-4000-8000-00000000f1c3' $$, 'the store''s finalizes');
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f1c3' and l.kind = 'charge'), 0, 'no line when the charge is 0');
select is((select total from public.invoices where week_id = '2099-12-14' and customer_id = '00000000-0000-4000-8000-00000000f1c3'),
  372.00, 'the store pays 62 lb x $6.00 only');

-- Reopened: a live draft again, with no stored charge line.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f1a1","role":"authenticated"}';
select lives_ok($$ select public.reopen_invoice(id) from public.invoices
  where week_id = '2099-12-14' and customer_id = '00000000-0000-4000-8000-00000000f1c1' $$, 'an admin reopens it');
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f1c1' and l.kind = 'charge'), 0, 'the reopened draft has no stored charge line');

select * from finish();
rollback;
