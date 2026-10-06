-- Contact roles, "Bills for all locations", and deleting unused customers.

begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'del-kathy@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'del-packing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000d1', 'Kathy', 'office'),
  ('00000000-0000-4000-8000-0000000000d2', 'Chris', 'packing');
insert into public.customers (id, name, bills_for_locations) values
  ('00000000-0000-4000-8000-0000000000f1', 'Del Chain', true),
  ('00000000-0000-4000-8000-0000000000f3', 'Del Unused', false),
  ('00000000-0000-4000-8000-0000000000f4', 'Del Has Log', false);
insert into public.customers (id, name, parent_customer_id) values
  ('00000000-0000-4000-8000-0000000000f2', 'Del Store', '00000000-0000-4000-8000-0000000000f1');
insert into public.customer_contacts (customer_id, name, roles) values
  ('00000000-0000-4000-8000-0000000000f1', 'Pat', '{orders,billing}'),
  ('00000000-0000-4000-8000-0000000000f3', 'Lee', '{receiving}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';

insert into public.contact_log (customer_id, kind, summary, deleted_at)
values ('00000000-0000-4000-8000-0000000000f4', 'call', 'Hidden note', now());

select throws_ok(
  $$ insert into public.customer_contacts (customer_id, name, roles) values ('00000000-0000-4000-8000-0000000000f3', 'X', '{boss}') $$,
  '23514', null, 'a contact role must be orders, receiving, or billing');

select is(
  public.customer_delete_check('00000000-0000-4000-8000-0000000000f1'),
  '{"orders": 0, "history": 0, "locations": 1, "cut_sheet_links": 0}'::jsonb,
  'the check counts a parent''s locations');
select is(
  (public.customer_delete_check('00000000-0000-4000-8000-0000000000f4') ->> 'history')::int, 1,
  'hidden contact log entries still count as history');

select throws_ok(
  $$ select public.delete_customer('00000000-0000-4000-8000-0000000000f1') $$,
  '23503', null, 'a parent with locations cannot be deleted');
select throws_ok(
  $$ delete from public.customers where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23503', null, 'not even with a plain delete');
select throws_ok(
  $$ select public.delete_customer('00000000-0000-4000-8000-0000000000f4') $$,
  '23503', null, 'a customer with history cannot be deleted');

-- Packing cannot delete.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
select throws_ok(
  $$ select public.delete_customer('00000000-0000-4000-8000-0000000000f3') $$,
  '42501', null, 'packing cannot delete customers');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select lives_ok(
  $$ select public.delete_customer('00000000-0000-4000-8000-0000000000f3') $$,
  'an unused customer can be deleted');
select is(
  (select count(*)::int from public.customer_contacts where customer_id = '00000000-0000-4000-8000-0000000000f3'), 0,
  'its contacts go with it');

-- A parent can go once its location is gone.
select lives_ok(
  $$ select public.delete_customer('00000000-0000-4000-8000-0000000000f2') $$,
  'the unused location can be deleted');
select lives_ok(
  $$ select public.delete_customer('00000000-0000-4000-8000-0000000000f1') $$,
  'then the parent can be deleted');

reset role;
select is(
  (select count(*)::int from public.audit_log where table_name = 'customers' and action = 'delete'
     and row_id in ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3')), 3,
  'the audit log keeps every deleted customer');

select * from finish();
rollback;
