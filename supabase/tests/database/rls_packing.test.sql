-- Proves the packing role is locked down (SPEC 4.8):
-- a packing user cannot read contact_log or write order_lines,
-- but can read orders and write packing_lines.
--
-- Run with:  npx supabase test db            (local stack)
--      or:   npx supabase test db --linked   (linked project; runs in a transaction and rolls back)

begin;
select plan(11);

-- Test users ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'rls-office@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'rls-packing@test.local');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Office', 'office'),
  ('00000000-0000-4000-8000-0000000000b2', 'Test Packing', 'packing');

-- Test data (inserted as the table owner, so RLS does not apply) ---------------
insert into public.products (id, name, unit, group_name) values ('rls-test-product', 'RLS test product', 'each', 'Other');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000c3', 'RLS Test Customer');
insert into public.weeks (id) values ('2099-01-05');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000000d4', '2099-01-05', '00000000-0000-4000-8000-0000000000c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty)
  values ('00000000-0000-4000-8000-0000000000d4', 'rls-test-product', 3);
insert into public.contact_log (customer_id, kind, summary, created_by)
  values ('00000000-0000-4000-8000-0000000000c3', 'call', 'Private note', '00000000-0000-4000-8000-0000000000a1');

-- Act as the packing user -----------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';

select is(public.app_role(), 'packing', 'app_role() reports packing');

select is_empty(
  $$ select * from public.contact_log $$,
  'packing cannot read contact_log'
);

select throws_ok(
  $$ insert into public.order_lines (order_id, product_id, qty)
     values ('00000000-0000-4000-8000-0000000000d4', 'rls-test-product', 1) $$,
  '42501', null,
  'packing cannot insert order_lines'
);

-- Updates and deletes blocked by RLS affect zero rows rather than erroring.
update public.order_lines set qty = 99 where order_id = '00000000-0000-4000-8000-0000000000d4';
delete from public.order_lines where order_id = '00000000-0000-4000-8000-0000000000d4';

select isnt_empty(
  $$ select * from public.order_lines where order_id = '00000000-0000-4000-8000-0000000000d4' $$,
  'packing can read order_lines'
);

select isnt_empty(
  $$ select * from public.orders where id = '00000000-0000-4000-8000-0000000000d4' $$,
  'packing can read orders'
);

select is_empty(
  $$ select * from public.cut_sets $$,
  'packing cannot read cut sets'
);

select lives_ok(
  $$ insert into public.packing_lines (order_id, product_id, packed_qty)
     values ('00000000-0000-4000-8000-0000000000d4', 'rls-test-product', 3) $$,
  'packing can write packing_lines'
);

select throws_ok(
  $$ insert into public.customers (name) values ('Sneaky') $$,
  '42501', null,
  'packing cannot add customers'
);

-- Back to the owner to check nothing changed ------------------------------------
reset role;

select is(
  (select qty from public.order_lines where order_id = '00000000-0000-4000-8000-0000000000d4'),
  3::numeric,
  'packing update and delete of order_lines had no effect'
);

-- Office user can read the contact log; packing write was audited -------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select isnt_empty(
  $$ select * from public.contact_log $$,
  'office can read contact_log'
);

reset role;

select ok(
  exists (
    select 1 from public.audit_log
    where table_name = 'packing_lines' and action = 'insert'
      and user_id = '00000000-0000-4000-8000-0000000000b2'
  ),
  'packing write was recorded in audit_log with the packer''s id'
);

select * from finish();
rollback;
