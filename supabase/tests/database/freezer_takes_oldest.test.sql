-- Take-outs by count come out of the oldest boxes first (migration 20261125000400).

begin;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000fd0a1', 'fo-admin@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-0000000fd0a1', 'FO Admin', 'admin');
insert into public.products (id, name, unit, group_name, price_unit) values ('fo-legs', 'FO Legs', 'each', 'Other', 'lb');
insert into public.prices (product_id, price, effective_from) values ('fo-legs', 8, '2099-01-01');
insert into public.half_whole_orders (id, customer_name, size, status) values ('00000000-0000-4000-8000-0000000fd0b1', 'FO Family', 'half', 'pending');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000fd0a1","role":"authenticated"}';
select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fd1a1","product_id":"fo-legs","qty":6,"weight_lb":36,"added_on":"2099-10-30","counts_as_income":true}');
select public.add_to_freezer('{"client_id":"00000000-0000-4000-8000-0000000fd1a2","product_id":"fo-legs","qty":6,"weight_lb":30,"added_on":"2099-11-01"}');

-- "Add or take out": take out 8.
insert into public.freezer_log (id, entry_date, product_id, qty, note) values ('00000000-0000-4000-8000-0000000fd2a1', '2099-11-03', 'fo-legs', -8, 'damaged');
select is((select string_agg(qty_left::text, ',' order by added_on) from public.freezer_boxes where product_id = 'fo-legs'), '0,4',
  'the oldest box empties first, then the next');
select is((select count(*)::int from public.freezer_takes where source_log_id = '00000000-0000-4000-8000-0000000fd2a1' and reason = 'taken_out' and not counts_in_pnl), 2,
  'two take-outs, not on the P&L');
select is((select sum(qty) from public.freezer_log where product_id = 'fo-legs'), 4::numeric, 'no extra log lines: on hand is 4');

-- Remove puts the boxes back.
delete from public.freezer_log where id = '00000000-0000-4000-8000-0000000fd2a1';
select is((select string_agg(qty_left::text, ',' order by added_on) from public.freezer_boxes where product_id = 'fo-legs'), '6,6', 'removing the line puts the boxes back');

-- A half lamb filled from the freezer.
insert into public.freezer_log (entry_date, product_id, qty, note, half_whole_order_id) values ('2099-11-10', 'fo-legs', -3, 'FO Family', '00000000-0000-4000-8000-0000000fd0b1');
select ok((select reason = 'half_whole' and counts_in_pnl and week_id = '2099-11-09' and qty = 3 from public.freezer_takes
  where half_whole_order_id = '00000000-0000-4000-8000-0000000fd0b1'), 'a half or whole order takes from the oldest box, and takes its freezer income back that week');
select is((select qty_left from public.freezer_boxes where client_id = '00000000-0000-4000-8000-0000000fd1a1'), 3::numeric, '3 left in the oldest box');
select is((select sum(qty) from public.freezer_log where product_id = 'fo-legs'), 9::numeric, 'on hand is 9');

-- More than the boxes hold: the rest was stock counted before boxes.
insert into public.freezer_log (entry_date, product_id, qty) values ('2099-11-11', 'fo-legs', 5);
insert into public.freezer_log (id, entry_date, product_id, qty) values ('00000000-0000-4000-8000-0000000fd2a2', '2099-11-12', 'fo-legs', -12);
select is((select coalesce(sum(qty_left), 0) from public.freezer_boxes where product_id = 'fo-legs'), 0::numeric, 'every box is emptied');
select is((select sum(qty) from public.freezer_takes where source_log_id = '00000000-0000-4000-8000-0000000fd2a2'), 9::numeric,
  'the boxes give 9 of the 12; the other 3 had no box');

-- Through Half and whole itself: filled, then back to pending.
delete from public.freezer_log where id = '00000000-0000-4000-8000-0000000fd2a2';
select lives_ok($$ select public.set_half_whole_status('00000000-0000-4000-8000-0000000fd0b1', 'filled', '{"fo-legs": 2}') $$,
  'mark the half lamb filled');
select is((select sum(qty) from public.freezer_takes where half_whole_order_id = '00000000-0000-4000-8000-0000000fd0b1'), 2::numeric,
  'it took 2 from the boxes (the earlier fill was replaced)');
select lives_ok($$ select public.set_half_whole_status('00000000-0000-4000-8000-0000000fd0b1', 'pending', '{}') $$, 'back to pending');
select is((select count(*)::int from public.freezer_takes where half_whole_order_id = '00000000-0000-4000-8000-0000000fd0b1'), 0,
  'and the boxes are put back');

select * from finish();
rollback;
