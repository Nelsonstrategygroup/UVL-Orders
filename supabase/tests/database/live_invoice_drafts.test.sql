-- Live invoice drafts (migration 20261108000100): every packed location has
-- a draft that follows packing whenever the week is opened, numbers follow
-- the week unless typed, Finalize brings the draft up to date first, and an
-- admin can reopen a finalized invoice (who and when kept).

begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e5a1', 'live-admin@test.local'),
  ('00000000-0000-4000-8000-00000000e5a2', 'live-billing@test.local'),
  ('00000000-0000-4000-8000-00000000e5a3', 'live-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000e5a1', 'Boss', 'admin'),
  ('00000000-0000-4000-8000-00000000e5a2', 'Biller', 'billing'),
  ('00000000-0000-4000-8000-00000000e5a3', 'Office', 'office');
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-00000000e5c1', 'Live A'),
  ('00000000-0000-4000-8000-00000000e5c2', 'Live B');
insert into public.customer_billing (customer_id, invoice_code) values
  ('00000000-0000-4000-8000-00000000e5c1', 'LVA'),
  ('00000000-0000-4000-8000-00000000e5c2', 'LVB');
insert into public.weeks (id, invoice_number) values ('2099-12-07', 99401);
insert into public.products (id, name, unit, group_name, price_unit) values ('lv-chops', 'Live chops', 'lb', 'Other', 'lb');
insert into public.prices (product_id, price, effective_from) values ('lv-chops', 10, '2099-01-01');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000e5b1', '2099-12-07', '00000000-0000-4000-8000-00000000e5c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000e5b2', '2099-12-07', '00000000-0000-4000-8000-00000000e5c2', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000e5b1', 'lv-chops', 20),
  ('00000000-0000-4000-8000-00000000e5b2', 'lv-chops', 20);
insert into public.packing_weights (id, order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000e5d1', '00000000-0000-4000-8000-00000000e5b1', 'lv-chops', 10.5);

-- Live A's invoice this week, and its chops line's quantity.
create function pg_temp.inv() returns public.invoices language sql as $$
  select * from public.invoices
  where week_id = '2099-12-07' and customer_id = '00000000-0000-4000-8000-00000000e5c1' and status <> 'void' $$;
create function pg_temp.qty() returns numeric language sql as $$
  select l.quantity from public.invoice_lines l
  where l.invoice_id = (pg_temp.inv()).id and l.product_id = 'lv-chops' $$;
create function pg_temp.changes() returns bigint language sql as $$
  select count(*) from public.audit_log where table_name in ('invoices', 'invoice_lines') $$;

-- Office (can see invoices) opens the week: a draft for the packed location only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a3","role":"authenticated"}';
select is(public.sync_invoice_drafts('2099-12-07')::text, '1', 'a draft for the packed location, made by opening the week');
select is((pg_temp.inv()).number, '99401-LVA', 'numbered from the week and the code');
select is(pg_temp.qty(), 10.5::numeric, 'billing the box weight');
reset role;
create temp table stamp as select pg_temp.changes() as n;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a3","role":"authenticated"}';
select is(public.sync_invoice_drafts('2099-12-07')::text, '0', 'opening again makes nothing');
reset role;
select is(pg_temp.changes(), (select n from stamp), 'and writes nothing when up to date');

-- A box reweighed and another location packed.
update public.packing_weights set weight = 12.25 where id = '00000000-0000-4000-8000-00000000e5d1';
insert into public.packing_weights (id, order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000e5d2', '00000000-0000-4000-8000-00000000e5b2', 'lv-chops', 8);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a3","role":"authenticated"}';
select is(public.sync_invoice_drafts('2099-12-07')::text, '1', 'the newly packed location gets its draft');
select is(pg_temp.qty(), 12.25::numeric, 'the new weight shows without deleting anything');

-- Numbers: typed by hand is kept; blank goes back to automatic; the week's number is followed.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a2","role":"authenticated"}';
update public.invoices set number = '99401-HAND' where id = (pg_temp.inv()).id;
select ok((pg_temp.inv()).number_by_hand, 'a typed number is marked');
select public.sync_invoice_drafts('2099-12-07');
select is((pg_temp.inv()).number, '99401-HAND', 'and kept');
update public.invoices set number = null where id = (pg_temp.inv()).id;
select public.sync_invoice_drafts('2099-12-07');
select is((pg_temp.inv()).number, '99401-LVA', 'blank: automatic again');
reset role;
update public.weeks set invoice_number = 99402 where id = '2099-12-07';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a2","role":"authenticated"}';
select public.sync_invoice_drafts('2099-12-07');
select is((pg_temp.inv()).number, '99402-LVA', 'the draft follows the week''s new number');

-- Nothing packed any more: the draft goes.
reset role;
delete from public.packing_weights where id = '00000000-0000-4000-8000-00000000e5d2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a2","role":"authenticated"}';
select public.sync_invoice_drafts('2099-12-07');
select is((select count(*)::text from public.invoices where week_id = '2099-12-07' and customer_id = '00000000-0000-4000-8000-00000000e5c2'),
  '0', 'a location with nothing packed has no draft');

-- Finalize brings it up to date first.
reset role;
update public.packing_weights set weight = 13 where id = '00000000-0000-4000-8000-00000000e5d1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a2","role":"authenticated"}';
select lives_ok($$ select public.finalize_invoice((pg_temp.inv()).id) $$, 'finalize');
select is((pg_temp.inv()).total, 130.00::numeric, 'with the weight packed now (13 lb x $10)');

-- Locked until an admin reopens it.
reset role;
update public.packing_weights set weight = 14 where id = '00000000-0000-4000-8000-00000000e5d1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a2","role":"authenticated"}';
select public.sync_invoice_drafts('2099-12-07');
select is(pg_temp.qty(), 13::numeric, 'a finalized invoice doesn''t follow packing');
select throws_ok($$ select public.reopen_invoice((pg_temp.inv()).id) $$, '42501', null, 'only an admin can reopen');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a1","role":"authenticated"}';
select lives_ok($$ select public.reopen_invoice((pg_temp.inv()).id) $$, 'an admin reopens it');
select is((select status || ' ' || coalesce(total::text, '-') || ' ' || reopened_by_name || ' ' || (reopened_at is not null)::text
  from public.invoices where id = (pg_temp.inv()).id), 'draft - Boss true', 'a draft again, who and when kept');
select is(pg_temp.qty(), 14::numeric, 'live again: the weight packed now');
select is((select count(*)::text from public.invoice_lines where invoice_id = (pg_temp.inv()).id and unit_price is not null),
  '0', 'prices from the price list again');
reset role;
select is((select count(*)::text from public.invoice_boxes where invoice_id = (pg_temp.inv()).id), '0', 'the kept boxes are cleared');
select is((select count(*)::text from public.audit_log where table_name = 'invoices' and row_id = (pg_temp.inv()).id::text
  and new_data ->> 'reopened_by_name' = 'Boss' and old_data ->> 'status' = 'finalized'), '1', 'the reopen is in the audit log');

-- With payments it can't be reopened.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e5a1","role":"authenticated"}';
select lives_ok($$ select public.finalize_invoice((pg_temp.inv()).id) $$, 'finalized again');
insert into public.payments (invoice_id, paid_on, amount, method) values ((pg_temp.inv()).id, '2099-12-20', 50, 'check');
select throws_ok($$ select public.reopen_invoice((pg_temp.inv()).id) $$, '22023', null, 'payments block reopening');

select * from finish();
rollback;
