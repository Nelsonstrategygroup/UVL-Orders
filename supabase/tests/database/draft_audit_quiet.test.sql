-- Draft audit (migration 20261115000300): a draft made or removed by packing
-- is logged and labelled; packing's automatic refreshes of its lines aren't;
-- packing itself and what people do to invoices still are.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f3a1', 'dq-packer@test.local'),
  ('00000000-0000-4000-8000-00000000f3a2', 'dq-billing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f3a1', 'DQ Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000f3a2', 'DQ Biller', 'billing');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000f3c1', 'DQ Market');
insert into public.weeks (id) values ('2099-11-09');
insert into public.products (id, name, unit, group_name, price_unit) values ('dq-chops', 'DQ chops', 'lb', 'Other', 'lb');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f3b1', '2099-11-09', '00000000-0000-4000-8000-00000000f3c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values ('00000000-0000-4000-8000-00000000f3b1', 'dq-chops', 20);

create function pg_temp.lines_logged() returns bigint language sql as $$
  select count(*) from public.audit_log where table_name = 'invoice_lines' and new_data ->> 'product_id' = 'dq-chops'
    or table_name = 'invoice_lines' and old_data ->> 'product_id' = 'dq-chops' $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f3a1","role":"authenticated"}';
insert into public.packing_weights (id, order_id, product_id, weight)
  values ('00000000-0000-4000-8000-00000000f3d1', '00000000-0000-4000-8000-00000000f3b1', 'dq-chops', 10);
insert into public.packing_weights (order_id, product_id, weight) values ('00000000-0000-4000-8000-00000000f3b1', 'dq-chops', 9);
update public.packing_weights set weight = 11 where id = '00000000-0000-4000-8000-00000000f3d1';
reset role;

select is((select source from public.audit_log where table_name = 'invoices' and action = 'insert'
  and new_data ->> 'customer_id' = '00000000-0000-4000-8000-00000000f3c1'), 'Draft made from packing', 'the draft being made is logged, labelled');
select is((select count(*)::int from public.audit_log where table_name = 'invoices' and action = 'update'
  and new_data ->> 'customer_id' = '00000000-0000-4000-8000-00000000f3c1'), 0, 'packing''s refreshes of the draft aren''t logged');
select is(pg_temp.lines_logged(), 0::bigint, 'nor its line rewrites');
select is((select count(*)::int from public.audit_log where table_name = 'packing_weights'
  and coalesce(new_data, old_data) ->> 'product_id' = 'dq-chops'), 3, 'every box change is logged as packing');
select is((select l.quantity from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
  where i.customer_id = '00000000-0000-4000-8000-00000000f3c1'), 20::numeric, 'and the draft is up to date');

-- A person's change to the draft is logged as usual.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f3a2","role":"authenticated"}';
update public.invoices set memo = 'Thanks!' where customer_id = '00000000-0000-4000-8000-00000000f3c1';
update public.invoices set memo = '' where customer_id = '00000000-0000-4000-8000-00000000f3c1';
reset role;
select is((select count(*)::int from public.audit_log where table_name = 'invoices' and action = 'update'
  and new_data ->> 'customer_id' = '00000000-0000-4000-8000-00000000f3c1'), 2, 'a person''s change is logged');

-- Nothing packed: the draft goes, logged and labelled.
delete from public.packing_weights where order_id = '00000000-0000-4000-8000-00000000f3b1';
select is((select count(*)::int from public.invoices where customer_id = '00000000-0000-4000-8000-00000000f3c1'), 0, 'the draft goes');
select is((select source from public.audit_log where table_name = 'invoices' and action = 'delete'
  and old_data ->> 'customer_id' = '00000000-0000-4000-8000-00000000f3c1'), 'Draft removed: nothing packed', 'its removal is logged, labelled');

select * from finish();
rollback;
