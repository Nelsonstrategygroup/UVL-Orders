-- Invoicing stage 3 (migration 20261030000100): finalize (checks, prices and
-- boxes copied, total), locked lines, date and number still changeable,
-- sent, payments, void and reissue.

begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f4a1', 'life-billing@test.local'),
  ('00000000-0000-4000-8000-00000000f4a2', 'life-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f4a1', 'Biller', 'billing'),
  ('00000000-0000-4000-8000-00000000f4a2', 'Office', 'office');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000f4c1', 'Life Market');
insert into public.customer_billing (customer_id, invoice_code, terms_days, bill_to_address) values
  ('00000000-0000-4000-8000-00000000f4c1', 'LIFE', 30, 'Box 1');
insert into public.weeks (id, invoice_number) values ('2099-11-02', 99301);
insert into public.products (id, name, unit, group_name, price_unit) values
  ('lf-chops', 'Life chops', 'lb', 'Other', 'lb'),
  ('lf-sticks', 'Life sticks', 'case', 'Other', 'case');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f4b1', '2099-11-02', '00000000-0000-4000-8000-00000000f4c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000f4b1', 'lf-chops', 30),
  ('00000000-0000-4000-8000-00000000f4b1', 'lf-sticks', 1);
insert into public.packing_weights (order_id, product_id, weight, lot) values
  ('00000000-0000-4000-8000-00000000f4b1', 'lf-chops', 12.345, 'L1'),
  ('00000000-0000-4000-8000-00000000f4b1', 'lf-chops', 17.1, 'L1'),
  ('00000000-0000-4000-8000-00000000f4b1', 'lf-sticks', 9.5, 'L2');
-- Chops 9.50 default, 9.25 for this customer from later; sticks none yet.
insert into public.prices (product_id, customer_id, price, effective_from) values
  ('lf-chops', null, 9.5, '2099-01-01'),
  ('lf-chops', '00000000-0000-4000-8000-00000000f4c1', 9.25, '2099-11-10');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f4a1","role":"authenticated"}';
select is(public.make_invoice_drafts('2099-11-02')::text, '1', 'a draft');
create temp table ids as select id from public.invoices where week_id = '2099-11-02';

select throws_ok($$ select public.finalize_invoice((select id from ids)) $$, '22023', null, 'Price needed blocks finalizing');
select throws_ok($$ update public.invoices set status = 'finalized' where id = (select id from ids) $$, '42501', null,
  'status changes only through Finalize');

reset role;
insert into public.prices (product_id, price, effective_from) values ('lf-sticks', 120, '2099-01-01');
update public.packing_weights set weight = 17.2 where product_id = 'lf-chops' and weight = 17.1;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f4a1","role":"authenticated"}';
select throws_ok($$ select public.finalize_invoice((select id from ids)) $$, '22023', null, 'out of date blocks finalizing');
select lives_ok($$ select public.update_invoice_draft((select id from ids)) $$, 'update from packing');
select lives_ok($$ update public.invoice_lines set discount_kind = 'amount', discount = 5, note = 'Short date'
  where invoice_id = (select id from ids) and product_id = 'lf-chops' $$, 'a $5 discount');
select lives_ok($$ insert into public.invoice_lines (invoice_id, kind, description, quantity, unit_price, note, sort)
  values ((select id from ids), 'manual', 'Credit', 1, -10.005, 'Broken box', 99) $$, 'a credit line');
select lives_ok($$ select public.finalize_invoice((select id from ids)) $$, 'finalize');

-- 29.545 lb x 9.50 = 280.6775 -> 280.68, less 5.00 = 275.68; sticks 1 x 120 = 120.00; credit -10.005 -> -10.01.
select is((select total from public.invoices where id = (select id from ids)), 385.67::numeric, 'total: each line rounded, less its discount');
select is((select unit_price from public.invoice_lines where invoice_id = (select id from ids) and product_id = 'lf-chops'), 9.5::numeric,
  'the default price on the invoice date (the customer''s own starts later)');
select is((select status from public.invoices where id = (select id from ids)), 'finalized', 'finalized');
select is((select terms_days::text || ' ' || due_date::text from public.invoices where id = (select id from ids)), '30 2099-12-03',
  'the customer''s terms and the due date');
select is((select issued ->> 'customer_name' || ' | ' || (issued ->> 'bill_to') from public.invoices where id = (select id from ids)),
  'Life Market | Box 1', 'name and bill-to as issued');
select is((select count(*)::text from public.invoice_boxes where invoice_id = (select id from ids)), '3', 'the boxes are kept');

select throws_ok($$ update public.invoice_lines set note = 'x' where invoice_id = (select id from ids) $$, '42501', null, 'lines are locked');
select throws_ok($$ update public.invoices set memo = 'x' where id = (select id from ids) $$, '42501', null, 'the note is locked');
select lives_ok($$ update public.invoices set invoice_date = '2099-11-05', number = '99301-LIFEX' where id = (select id from ids) $$,
  'date and number can still change');
select is((select due_date::text from public.invoices where id = (select id from ids)), '2099-12-05', 'the due date follows the date');
select is((select total from public.invoices where id = (select id from ids)), 385.67::numeric, 'prices stay as issued');
delete from public.invoices where id = (select id from ids);
select is((select count(*)::text from public.invoices where id = (select id from ids)), '1', 'a finalized invoice can''t be deleted');

select lives_ok($$ select public.mark_invoice_sent((select id from ids), true) $$, 'mark sent');
select lives_ok($$ insert into public.payments (invoice_id, paid_on, amount, method, reference) values ((select id from ids), '2099-11-20', 100, 'check', '1042') $$,
  'a partial payment by check');
select throws_ok($$ select public.void_invoice((select id from ids), 'Wrong weight') $$, '22023', null, 'payments block voiding');
select lives_ok($$ delete from public.payments where invoice_id = (select id from ids) $$, 'payment deleted');
select throws_ok($$ select public.void_invoice((select id from ids), ' ') $$, '22023', null, 'a reason is needed');
select lives_ok($$ select public.void_invoice((select id from ids), 'Wrong weight') $$, 'void');
select lives_ok($$ select public.reissue_invoice((select id from ids)) $$, 'reissue');
select is((select number || ' ' || status || ' ' || reissue from public.invoices where replaces_id = (select id from ids)),
  '99301-LIFEX-R1 draft 1', 'the reissue is a draft numbered -R1');
select is((select count(*)::text from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.replaces_id = (select id from ids) and (l.kind = 'manual' or l.discount is not null)), '2', 'with the added line and the discount');
select throws_ok($$ insert into public.payments (invoice_id, paid_on, amount, method) values ((select id from ids), '2099-11-20', 10, 'ach') $$,
  '42501', null, 'no payments on a void invoice');

select * from finish();
rollback;
