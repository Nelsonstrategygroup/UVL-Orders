-- Requested lines for a later week (change request 10/22/26, part B): move a
-- line to next week and undo, request directly, confirm, the cut sheet, and
-- who may do it.

begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000007a1', 'rq-office@test.local'),
  ('00000000-0000-4000-8000-0000000007b2', 'rq-packing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000007a1', 'Kathy', 'office'),
  ('00000000-0000-4000-8000-0000000007b2', 'Chris', 'packing');

insert into public.cut_specs (id, text, use_type) values ('rq-fs', 'RQ front shanks', 'fshank');
insert into public.products (id, name, unit, group_name, cut_spec_id, sort) values
  ('rq-fs', 'RQ Front Shanks', 'pack', 'Shanks', 'rq-fs', 0),
  ('rq-legs', 'RQ Legs', 'each', 'Legs', null, 1);
insert into public.product_cut_specs (product_id, cut_spec_id, units_per_cut) values ('rq-fs', 'rq-fs', 0.5);
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000007c3', 'RQ Market');

insert into public.weeks (id) values ('2099-04-06');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000007d4', '2099-04-06', '00000000-0000-4000-8000-0000000007c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-0000000007d4', 'rq-fs', 12),
  ('00000000-0000-4000-8000-0000000007d4', 'rq-legs', 6);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000007a1","role":"authenticated"}';

-- Move to next week -----------------------------------------------------------
create temp table moved on commit drop as
select public.move_line_to_next_week('2099-04-06', '00000000-0000-4000-8000-0000000007c3', 'rq-fs') as id;
select is(
  (select count(*)::int from public.order_lines where order_id = '00000000-0000-4000-8000-0000000007d4' and product_id = 'rq-fs'),
  0, 'the line comes off this week''s order');
select is(
  (select week_id || ':' || qty || ':' || moved_from_week || ':' || requested_by from public.order_requests where id = (select id from moved)),
  '2099-04-13:12:2099-04-06:00000000-0000-4000-8000-0000000007a1',
  'it is requested for next week, from this week, by who moved it');
select is(
  (select count(*)::int from public.orders where week_id = '2099-04-13'), 0,
  'next week has no order yet, so the customer is still "Not called" there');

-- Undo puts it back -----------------------------------------------------------
select lives_ok($$ select public.undo_move_line((select id from moved)) $$, 'undo the move');
select is(
  (select qty::int from public.order_lines where order_id = '00000000-0000-4000-8000-0000000007d4' and product_id = 'rq-fs'),
  12, 'the line is back on this week');
select is((select count(*)::int from public.order_requests), 0, 'and the request is gone');

-- Request directly, then confirm with a changed amount ------------------------
create temp table asked on commit drop as
select public.request_line('2099-04-20', '00000000-0000-4000-8000-0000000007c3', 'rq-legs', 10) as id;
select is((select week_id::text from public.order_requests where id = (select id from asked)), '2099-04-20', 'a request for a later week');

-- The cut sheet for that week includes it --------------------------------------
select public.start_cut_sheet('2099-04-20', null);
insert into public.cut_set_customers (set_id, customer_id)
select id, '00000000-0000-4000-8000-0000000007c3' from public.cut_sets where week_id = '2099-04-20';
select public.request_line('2099-04-20', '00000000-0000-4000-8000-0000000007c3', 'rq-fs', 3);
create temp table filled on commit drop as
select public.fill_cut_set((select id from public.cut_sets where week_id = '2099-04-20')) as r;
select is((select (r ->> 'requested')::int from filled), 2, '"Put these on this set" says it includes 2 requested lines');
select is(
  (select string_agg(cut_spec_id || '=' || qty, ',') from public.cut_set_lines l join public.cut_sets s on s.id = l.set_id
   where s.week_id = '2099-04-20' and l.kind = 'line' and l.cut_spec_id = 'rq-fs'),
  'rq-fs=6', 'the requested 3 packs of front shanks go on the set (6 shanks)');

select lives_ok($$ select public.confirm_request((select id from asked), 8) $$, 'confirm with the amount from the call');
select is(
  (select o.status || ':' || l.qty from public.orders o join public.order_lines l on l.order_id = o.id
   where o.week_id = '2099-04-20' and l.product_id = 'rq-legs'),
  'ordered:8', 'it becomes a normal line and the order is ordered');

-- Drop and undo (the screen deletes the row and puts it back) ------------------
create temp table dropped on commit drop as
select * from public.order_requests where product_id = 'rq-fs' and week_id = '2099-04-20';
delete from public.order_requests where id = (select id from dropped);
insert into public.order_requests select * from dropped;
select is((select count(*)::int from public.order_requests where week_id = '2099-04-20'), 1, 'drop, then undo');

-- Packing can't see or change requests ------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000007b2","role":"authenticated"}';
select is((select count(*)::int from public.order_requests), 0, 'Packing doesn''t see requested lines');
select throws_ok(
  $$ select public.request_line('2099-04-27', '00000000-0000-4000-8000-0000000007c3', 'rq-legs', 1) $$,
  '42501', null, 'Packing can''t request lines');

select * from finish();
rollback;
