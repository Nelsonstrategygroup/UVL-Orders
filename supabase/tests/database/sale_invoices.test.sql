-- Stand-alone sale invoices (migration 20261125000300): a sale lives beside
-- the location's weekly invoice, packing never touches it, it's numbered
-- -S1, -S2, moves with its date while a draft, finalizes with no freight or
-- boxes from packing, and reissues with its lines.

begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f5a1', 'sale-admin@test.local'),
  ('00000000-0000-4000-8000-00000000f5a2', 'sale-billing@test.local'),
  ('00000000-0000-4000-8000-00000000f5a3', 'sale-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f5a1', 'Boss', 'admin'),
  ('00000000-0000-4000-8000-00000000f5a2', 'Biller', 'billing'),
  ('00000000-0000-4000-8000-00000000f5a3', 'Office', 'office');
insert into public.user_permissions (user_id, area, level) values ('00000000-0000-4000-8000-00000000f5a3', 'invoices', 1);
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000f5c1', 'Sale A');
insert into public.customer_billing (customer_id, invoice_code) values ('00000000-0000-4000-8000-00000000f5c1', 'SLA');
insert into public.weeks (id, invoice_number) values ('2099-12-14', 99501), ('2099-12-21', 99502);
insert into public.products (id, name, unit, group_name, price_unit) values
  ('sl-chops', 'Sale chops', 'lb', 'Other', 'lb'),
  ('sl-sticks', 'Sale sticks', 'case', 'Other', 'case');
insert into public.prices (product_id, price, effective_from) values
  ('sl-chops', 10, '2099-01-01'),
  ('sl-sticks', 48, '2099-01-01');
insert into public.freight_charges (customer_id, method, amount, effective_from)
  values ('00000000-0000-4000-8000-00000000f5c1', 'per_delivery', 25, '2099-01-01');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f5b1', '2099-12-14', '00000000-0000-4000-8000-00000000f5c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values ('00000000-0000-4000-8000-00000000f5b1', 'sl-chops', 20);
insert into public.packing_weights (id, order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000f5d1', '00000000-0000-4000-8000-00000000f5b1', 'sl-chops', 10.5);

create table public._sale_ids (k text primary key, id uuid);
grant all on public._sale_ids to authenticated;

-- Someone who can only see invoices can't make a sale.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a3","role":"authenticated"}';
select throws_ok($$ select public.make_sale_invoice('00000000-0000-4000-8000-00000000f5c1', '2099-12-15') $$,
  '42501', null, 'view only: no new sale');

-- Billing makes one on Tuesday 12/15: the week of Monday 12/14.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a2","role":"authenticated"}';
insert into public._sale_ids values ('s1', public.make_sale_invoice('00000000-0000-4000-8000-00000000f5c1', '2099-12-15'));
select is((select week_id from public.invoices where id = (select id from public._sale_ids where k = 's1')), '2099-12-14'::date, 'in the order week holding its date');
select is((select number from public.invoices where id = (select id from public._sale_ids where k = 's1')), '99501-SLA-S1', 'numbered -S1');
select is((select sale_no from public.invoices where id = (select id from public._sale_ids where k = 's1')), 1, 'sale 1');

-- The weekly invoice is still there beside it, and opening the week leaves the sale alone.
select public.sync_invoice_drafts('2099-12-14');
select is((select count(*)::int from public.invoices where week_id = '2099-12-14' and sale_no is null and status <> 'void'), 1,
  'the location still has its weekly invoice');
select is((select number from public.invoices where week_id = '2099-12-14' and sale_no is null), '99501-SLA', 'with its usual number');
select is((select count(*)::int from public.invoice_lines where invoice_id = (select id from public._sale_ids where k = 's1')), 0, 'nothing from packing on the sale');
select is((select count(*)::int from public.invoices where id = (select id from public._sale_ids where k = 's1')), 1, 'an empty sale isn''t deleted for "nothing packed"');

-- Product lines.
insert into public.invoice_lines (invoice_id, kind, product_id, description, quantity, price_unit, boxes, sort)
values ((select id from public._sale_ids where k = 's1'), 'inventory', 'sl-chops', 'Sale chops', 12.345, 'lb', 1, 1),
       ((select id from public._sale_ids where k = 's1'), 'inventory', 'sl-sticks', 'Sale sticks', 2, 'case', 2, 2);
select throws_ok($$ insert into public.invoice_lines (invoice_id, kind, product_id, description, quantity, price_unit, sort)
  values ((select id from public._sale_ids where k = 's1'), 'inventory', 'sl-chops', 'Sale chops', 0, 'lb', 3) $$,
  '23514', null, 'a product line needs an amount above 0');

-- Packing changes: the weekly draft follows, the sale doesn't.
reset role;
update public.packing_weights set weight = 11 where id = '00000000-0000-4000-8000-00000000f5d1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a2","role":"authenticated"}';
select public.sync_invoice_drafts('2099-12-14');
select is((select l.quantity from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.week_id = '2099-12-14' and i.sale_no is null and l.product_id = 'sl-chops'), 11.000::numeric, 'the weekly draft follows packing');
select is((select count(*)::int from public.invoice_lines where invoice_id = (select id from public._sale_ids where k = 's1')), 2, 'the sale keeps just its own lines');
select is((select fingerprint from public.invoice_fingerprints('2099-12-14') where invoice_id = (select id from public._sale_ids where k = 's1')), '',
  'a sale''s fingerprint never changes with packing');

-- A second sale the same week: -S2.
insert into public._sale_ids values ('s2', public.make_sale_invoice('00000000-0000-4000-8000-00000000f5c1', '2099-12-16'));
select is((select number from public.invoices where id = (select id from public._sale_ids where k = 's2')), '99501-SLA-S2', 'the next sale is -S2');

-- A sale stays a sale.
select throws_ok($$ update public.invoices set sale_no = 5 where id = (select id from public._sale_ids where k = 's2') $$, '42501', null, 'the sale number can''t be typed');
select throws_ok($$ update public.invoices set sale_no = null where id = (select id from public._sale_ids where k = 's2') $$, '42501', null, 'a sale can''t become a weekly invoice');

-- Moving its date into the next order week moves the draft with it.
update public.invoices set invoice_date = '2099-12-18' where id = (select id from public._sale_ids where k = 's2');
select is((select week_id from public.invoices where id = (select id from public._sale_ids where k = 's2')), '2099-12-21'::date, 'Friday 12/18 is the week of 12/21');
select is((select number from public.invoices where id = (select id from public._sale_ids where k = 's2')), '99502-SLA-S1', 'renumbered for that week');

-- Finalize: an empty sale can't be; one with lines gets no freight and no boxes.
select throws_ok($$ select public.finalize_invoice((select id from public._sale_ids where k = 's2')) $$, '22023', 'Add a product first.', 'an empty sale can''t be finalized');
select public.finalize_invoice((select id from public._sale_ids where k = 's1'));
select is((select status from public.invoices where id = (select id from public._sale_ids where k = 's1')), 'finalized', 'finalized');
-- 12.345 lb x $10 = $123.45; 2 cases x $48 = $96.00.
select is((select total from public.invoices where id = (select id from public._sale_ids where k = 's1')), 219.45::numeric, 'total from the lines');
select is((select count(*)::int from public.invoice_lines where invoice_id = (select id from public._sale_ids where k = 's1') and kind = 'freight'), 0, 'no freight on a sale');
select is((select count(*)::int from public.invoice_boxes where invoice_id = (select id from public._sale_ids where k = 's1')), 0, 'no packing boxes on a sale');
select is((select unit_price from public.invoice_lines where invoice_id = (select id from public._sale_ids where k = 's1') and product_id = 'sl-chops'), 10.0000::numeric,
  'the price is copied onto the line');

-- The weekly invoice still finalizes with its freight and boxes.
select public.finalize_invoice((select id from public.invoices where week_id = '2099-12-14' and sale_no is null));
select is((select count(*)::int from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.week_id = '2099-12-14' and i.sale_no is null and l.kind = 'freight'), 1, 'the weekly invoice gets its freight');
select is((select count(*)::int from public.invoice_boxes b join public.invoices i on i.id = b.invoice_id
  where i.week_id = '2099-12-14' and i.sale_no is null), 1, 'and its box');

-- A finalized sale's date change doesn't move its week.
update public.invoices set invoice_date = '2099-12-18' where id = (select id from public._sale_ids where k = 's1');
select is((select week_id from public.invoices where id = (select id from public._sale_ids where k = 's1')), '2099-12-14'::date, 'a finalized sale stays in its week');

-- Void and reissue: the same sale, -R1, with its lines (prices from the list again).
select public.void_invoice((select id from public._sale_ids where k = 's1'), 'Wrong weight');
insert into public._sale_ids values ('r1', public.reissue_invoice((select id from public._sale_ids where k = 's1')));
select is((select number from public.invoices where id = (select id from public._sale_ids where k = 'r1')), '99501-SLA-S1-R1', 'reissued as -S1-R1');
select is((select count(*)::int from public.invoice_lines where invoice_id = (select id from public._sale_ids where k = 'r1') and kind = 'inventory' and unit_price is null), 2,
  'its product lines copied, priced from the list again');
select throws_ok($$ select public.reissue_invoice((select id from public._sale_ids where k = 's1')) $$, '23505', 'This sale has already been reissued.', 'only once');

-- A closed week takes no new sale.
reset role;
insert into public.pnl_closed_weeks (week_id, snapshot) values ('2099-12-21', '{}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a2","role":"authenticated"}';
select throws_ok($$ select public.make_sale_invoice('00000000-0000-4000-8000-00000000f5c1', '2099-12-22') $$, '22023', null,
  'no new sale in a closed week');

reset role;
select * from finish();
rollback;
