-- Closing a week (migration 20261116000100): admins review, close and reopen
-- a week; a closed week refuses changes to its orders, packing, invoices,
-- weigh sheets, expenses and adjustments (marking an invoice sent is still
-- fine); opening its invoices leaves its drafts alone; reopening needs a
-- reason; every review, close and reopen is logged; others see none of it.

begin;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f5a1', 'cw-admin@test.local'),
  ('00000000-0000-4000-8000-00000000f5a2', 'cw-packer@test.local'),
  ('00000000-0000-4000-8000-00000000f5a3', 'cw-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f5a1', 'CW Admin', 'admin'),
  ('00000000-0000-4000-8000-00000000f5a2', 'CW Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000f5a3', 'CW Office', 'office');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000f5c1', 'CW Market');
-- Reviewing is for owners (20261121000100).
insert into public.pnl_owners (name, profile_id) values ('CW Admin', '00000000-0000-4000-8000-00000000f5a1');
insert into public.customer_billing (customer_id, invoice_code) values ('00000000-0000-4000-8000-00000000f5c1', 'CWM');
insert into public.weeks (id, invoice_number) values ('2099-11-02', 99701), ('2099-11-09', 99702);
insert into public.products (id, name, unit, group_name, price_unit) values ('cw-chops', 'CW chops', 'lb', 'Other', 'lb');
insert into public.prices (product_id, price, effective_from) values ('cw-chops', 10, '2099-01-01');
insert into public.orders (id, week_id, customer_id, status) values
  ('00000000-0000-4000-8000-00000000f5b1', '2099-11-02', '00000000-0000-4000-8000-00000000f5c1', 'ordered'),
  ('00000000-0000-4000-8000-00000000f5b2', '2099-11-09', '00000000-0000-4000-8000-00000000f5c1', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-00000000f5b1', 'cw-chops', 20),
  ('00000000-0000-4000-8000-00000000f5b2', 'cw-chops', 20);
insert into public.packing_weights (id, order_id, product_id, weight) values
  ('00000000-0000-4000-8000-00000000f5d1', '00000000-0000-4000-8000-00000000f5b1', 'cw-chops', 10.5);
insert into public.expense_categories (id, name) values ('00000000-0000-4000-8000-00000000f5e1', 'CW Butcher');
insert into public.pnl_expenses (id, entry_date, category_id, amount) values
  ('00000000-0000-4000-8000-00000000f5e2', '2099-11-02', '00000000-0000-4000-8000-00000000f5e1', 500);
insert into public.producers (id, name) values ('00000000-0000-4000-8000-00000000f5f1', 'CW Ranch');
insert into public.kill_sheets (id, producer_id, kill_date, base_rate, live_factor, rate_source) values
  ('00000000-0000-4000-8000-00000000f5f2', '00000000-0000-4000-8000-00000000f5f1', '2099-10-30', 3, 2, 'base');

-- Review and close, as an admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a1","role":"authenticated"}';
select lives_ok($$ select public.review_pnl_week('2099-11-02', true) $$, 'an admin marks the week reviewed');
select is((select name from public.pnl_week_reviews where week_id = '2099-11-02'), 'CW Admin', 'who reviewed it');
select throws_ok($$ insert into public.pnl_closed_weeks (week_id, snapshot) values ('2099-11-02', '{}') $$,
  '42501', null, 'closing is only through close_pnl_week');
select lives_ok($$ select public.close_pnl_week('2099-11-02', '{"income":"100"}', array['No Butcher (Mohawk) cost entered.']) $$,
  'an admin closes the week');
select is((select closed_by_name || ' / ' || (snapshot ->> 'income') from public.pnl_closed_weeks where week_id = '2099-11-02'),
  'CW Admin / 100', 'the snapshot and who closed it are saved');
select throws_ok($$ select public.close_pnl_week('2099-11-02', '{}', '{}') $$, '42501', null, 'it can''t be closed twice');
select ok(public.week_is_closed('2099-11-02') and not public.week_is_closed('2099-11-09'), 'only that week is closed');

-- The closed week's rows can't change.
select throws_ok($$ update public.order_lines set qty = 25 where order_id = '00000000-0000-4000-8000-00000000f5b1' $$,
  '55000', null, 'an order line');
select throws_ok($$ update public.orders set status = 'callback' where id = '00000000-0000-4000-8000-00000000f5b1' $$,
  '55000', null, 'an order');
select throws_ok($$ insert into public.pnl_expenses (entry_date, category_id, amount)
  values ('2099-11-03', '00000000-0000-4000-8000-00000000f5e1', 20) $$, '55000', null, 'a new expense dated in the week');
select throws_ok($$ update public.pnl_expenses set entry_date = '2099-11-09' where id = '00000000-0000-4000-8000-00000000f5e2' $$,
  '55000', null, 'an expense moved out of the week');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2099-11-02', 'adjustment', 'producer', 'expense', -10, 'x') $$, '55000', null, 'an adjustment');
select throws_ok($$ insert into public.kill_lambs (sheet_id, position, carcass_lb) values ('00000000-0000-4000-8000-00000000f5f2', 1, 70) $$,
  '55000', null, 'a weigh sheet lamb');
select throws_ok($$ update public.kill_sheets set notes = 'x' where id = '00000000-0000-4000-8000-00000000f5f2' $$,
  '55000', null, 'a weigh sheet');
select lives_ok($$ insert into public.pnl_expenses (entry_date, category_id, amount)
  values ('2099-11-10', '00000000-0000-4000-8000-00000000f5e1', 20) $$, 'the next week is open');

-- Packing can't add a box to a closed week; the next week is fine.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a2","role":"authenticated"}';
select throws_ok($$ insert into public.packing_weights (order_id, product_id, weight)
  values ('00000000-0000-4000-8000-00000000f5b1', 'cw-chops', 9) $$, '55000', null, 'packing a box in a closed week');
select lives_ok($$ insert into public.packing_weights (order_id, product_id, weight)
  values ('00000000-0000-4000-8000-00000000f5b2', 'cw-chops', 9) $$, 'packing the next week');
select is((select count(*)::int from public.pnl_closed_weeks), 0, 'packing doesn''t see closed weeks');

-- Opening the closed week's invoices leaves it alone (no draft made).
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a1","role":"authenticated"}';
select is(public.sync_invoice_drafts('2099-11-02'), 0, 'no draft made for a closed week');

-- Reopen: a reason is needed; then changes work again.
select throws_ok($$ select public.reopen_pnl_week('2099-11-02', '  ') $$, '23514', null, 'reopening needs a reason');
select lives_ok($$ select public.reopen_pnl_week('2099-11-02', 'Mohawk bill came in') $$, 'reopened with a reason');
select lives_ok($$ update public.order_lines set qty = 25 where order_id = '00000000-0000-4000-8000-00000000f5b1' $$,
  'a reopened week can change');
select is((select string_agg(action || ':' || by_name || ':' || reason || ':' || array_to_string(missing, '|'), ', ' order by at, action)
  from public.pnl_week_events where week_id = '2099-11-02'),
  'closed:CW Admin::No Butcher (Mohawk) cost entered., reopened:CW Admin:Mohawk bill came in:, reviewed:CW Admin::',
  'every review, close and reopen is logged');

-- Closed, a finalized invoice can still be marked sent.
select lives_ok($$ select public.sync_invoice_drafts('2099-11-02') $$, 'the draft is made');
select public.finalize_invoice(id) from public.invoices where week_id = '2099-11-02';
select public.close_pnl_week('2099-11-02', '{}', '{}');
select lives_ok($$ select public.mark_invoice_sent(id, true) from public.invoices where week_id = '2099-11-02' $$,
  'marking a closed week''s invoice sent is fine');

-- Others can't review or close.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f5a3","role":"authenticated"}';
select throws_ok($$ select public.reopen_pnl_week('2099-11-02', 'x') $$, '42501', null, 'office can''t reopen');

select * from finish();
rollback;
