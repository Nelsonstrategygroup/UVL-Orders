-- Phase 5: contact log author rules, follow-ups done by anyone in the office,
-- and saving half and whole orders.

begin;
select plan(17);

insert into public.parts (id, name, per_lamb, unit, balance_check, sort) values
  ('leg', 'Leg', 2, 'each', true, 0)
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'p5-kathy@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'p5-eric@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'p5-packing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Kathy', 'office'),
  ('00000000-0000-4000-8000-0000000000a2', 'Eric', 'admin'),
  ('00000000-0000-4000-8000-0000000000b2', 'Chris', 'packing');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000c3', 'P5 Test Market');
insert into public.products (id, name, unit, group_name) values ('p5-leg', 'P5 leg', 'each', 'Legs');

set local role authenticated;

-- Kathy logs a call with a follow-up.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
insert into public.contact_log (id, customer_id, kind, summary, follow_up_date)
values ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000c3', 'call', 'Wants loin chops', '2099-01-01');
select lives_ok(
  $$ update public.contact_log set summary = 'Wants loin chops next month' where id = '00000000-0000-4000-8000-0000000000e5' $$,
  'the author can edit her entry');

-- Eric cannot edit or delete Kathy's entry...
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
update public.contact_log set summary = 'changed by Eric', deleted_at = now() where id = '00000000-0000-4000-8000-0000000000e5';
select is(
  (select summary || ':' || (deleted_at is null) from public.contact_log where id = '00000000-0000-4000-8000-0000000000e5'),
  'Wants loin chops next month:true', 'someone else cannot edit or delete the entry');

-- ...but can mark the follow-up done, and only that changes.
select lives_ok(
  $$ select public.set_follow_up_done('00000000-0000-4000-8000-0000000000e5', true) $$,
  'anyone in the office can mark a follow-up done');
select is(
  (select follow_up_done::text || ':' || summary from public.contact_log where id = '00000000-0000-4000-8000-0000000000e5'),
  'true:Wants loin chops next month', 'marking done changes only the follow-up');

-- Kathy deletes (hides) her entry; nobody can hard-delete.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update public.contact_log set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000e5' $$,
  'the author can delete her entry, which hides it');
select throws_ok(
  $$ delete from public.contact_log where id = '00000000-0000-4000-8000-0000000000e5' $$,
  '42501', null, 'nobody can hard-delete a contact log entry');

-- Half and whole orders.
create temp table hw on commit drop as
select public.save_half_whole(
  '{"customer_name":"P5 Family","phone":"541-555-0199","size":"whole","status":"pending","need_by":"2099-01-15","notes":"Thick chops"}',
  '[{"part_id":"leg","slot":0,"product_id":"p5-leg"},{"part_id":"leg","slot":1,"product_id":"p5-leg"}]'
) as id;
select is(
  (select o.size || ':' || o.status || ':' || (select count(*) from public.half_whole_choices c where c.order_id = o.id)
   from public.half_whole_orders o where o.id = (select id from hw)),
  'whole:pending:2', 'a new order saves with its choices');

select public.save_half_whole(
  jsonb_build_object('id', (select id from hw), 'customer_name', 'P5 Family', 'size', 'half', 'status', 'pending'),
  '[{"part_id":"leg","slot":0,"product_id":"p5-leg"}]');
select is(
  (select o.size || ':' || (select count(*) from public.half_whole_choices c where c.order_id = o.id)
   from public.half_whole_orders o where o.id = (select id from hw)),
  'half:1', 'changing to a half drops the extra choice');

-- Option A: filling takes only what the freezer had, logged against the order.
insert into public.freezer_log (product_id, qty, note) values ('p5-leg', 3, 'put in');
select public.set_half_whole_status((select id from hw), 'filled', '{"p5-leg": 1}');
select is(
  (select status from public.half_whole_orders where id = (select id from hw)), 'filled', 'mark filled sets the status');
select is(
  (select sum(qty) from public.freezer_log where product_id = 'p5-leg'), 2::numeric,
  'filling logs what it took from the freezer (3 in, 1 taken)');
select is(
  (select count(*)::int from public.freezer_log where half_whole_order_id = (select id from hw)), 1,
  'the withdrawal is tied to the order');
select public.set_half_whole_status((select id from hw), 'pending');
select is(
  (select sum(qty) from public.freezer_log where product_id = 'p5-leg'), 3::numeric,
  'un-filling (or Undo) puts the cuts back');
select throws_ok(
  $$ select public.save_half_whole(jsonb_build_object('id', (select id from hw), 'customer_name', 'P5 Family', 'size', 'half', 'status', 'filled'), '[]') $$,
  '22023', null, 'the form cannot mark an order filled without updating the freezer');

select throws_ok(
  $$ select public.save_half_whole('{"customer_name":"  ","size":"half"}', '[]') $$,
  '22023', null, 'a name is required');

-- Packing cannot.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$ select public.set_follow_up_done('00000000-0000-4000-8000-0000000000e5', false) $$,
  '42501', null, 'packing cannot mark follow-ups');
select throws_ok(
  $$ select public.save_half_whole('{"customer_name":"X","size":"half"}', '[]') $$,
  '42501', null, 'packing cannot save half and whole orders');
select is_empty($$ select 1 from public.half_whole_orders $$, 'packing cannot see half and whole orders');

reset role;
select * from finish();
rollback;
