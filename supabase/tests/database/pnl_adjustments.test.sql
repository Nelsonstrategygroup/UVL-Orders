-- P&L adjustments (migration 20261115000400): admins add adjustments and
-- one-off lines with a reason; who and when come from the database; they
-- can't be changed or deleted, only voided with a reason; office sees none.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f4a1', 'adj-admin@test.local'),
  ('00000000-0000-4000-8000-00000000f4a2', 'adj-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f4a1', 'Adj Admin', 'admin'),
  ('00000000-0000-4000-8000-00000000f4a2', 'Adj Office', 'office');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f4a1","role":"authenticated"}';

select lives_ok($$ insert into public.pnl_adjustments (id, week_id, kind, line_key, side, amount, reason)
  values ('00000000-0000-4000-8000-00000000f4d1', '2026-11-16', 'adjustment', 'producer', 'expense', -250, 'Dock: 2 lambs condemned') $$,
  'an admin adjusts producer cost');
select is((select created_by_name from public.pnl_adjustments where id = '00000000-0000-4000-8000-00000000f4d1'), 'Adj Admin', 'who is recorded');
select lives_ok($$ insert into public.pnl_adjustments (week_id, kind, side, label, amount, reason)
  values ('2026-11-16', 'one_off', 'expense', 'Freight bill (Heritage)', 412.50, 'Bill #4471') $$, 'a one-off expense line');
select lives_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2026-11-16', 'adjustment', 'charge:ALB/OSC', 'expense', 3.60, 'Two lambs missing from the sheet') $$, 'a charge can be adjusted');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2026-11-16', 'adjustment', 'producer', 'expense', 10, '  ') $$, '23514', null, 'a reason is required');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2026-11-17', 'adjustment', 'producer', 'expense', 10, 'x') $$, '23514', null, 'the week is a packing Monday');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2026-11-16', 'adjustment', 'income', 'expense', 10, 'x') $$, '23514', null, 'income is on the income side');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, side, amount, reason)
  values ('2026-11-16', 'one_off', 'income', 10, 'x') $$, '23514', null, 'a one-off line needs a name');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2026-11-16', 'adjustment', 'producer', 'expense', 0, 'x') $$, '23514', null, 'an adjustment isn''t 0');

select throws_ok($$ update public.pnl_adjustments set amount = -300 where id = '00000000-0000-4000-8000-00000000f4d1' $$,
  '42501', null, 'an adjustment can''t be changed');
select throws_ok($$ update public.pnl_adjustments set voided_at = now() where id = '00000000-0000-4000-8000-00000000f4d1' $$,
  '23514', null, 'voiding needs a reason');
select lives_ok($$ update public.pnl_adjustments set voided_at = now(), void_reason = 'Entered twice'
  where id = '00000000-0000-4000-8000-00000000f4d1' $$, 'voided with a reason');
select is((select voided_by_name || ' / ' || void_reason from public.pnl_adjustments where id = '00000000-0000-4000-8000-00000000f4d1'),
  'Adj Admin / Entered twice', 'who voided it and why');
select throws_ok($$ update public.pnl_adjustments set voided_at = null, void_reason = '' where id = '00000000-0000-4000-8000-00000000f4d1' $$,
  '42501', null, 'a voided adjustment stays voided');
select throws_ok($$ delete from public.pnl_adjustments where id = '00000000-0000-4000-8000-00000000f4d1' $$, '42501', null, 'it can''t be deleted');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f4a2","role":"authenticated"}';
select is((select count(*)::int from public.pnl_adjustments), 0, 'office sees none');

select * from finish();
rollback;
