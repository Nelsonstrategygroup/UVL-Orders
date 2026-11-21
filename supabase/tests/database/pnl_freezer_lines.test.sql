-- Adjustments to Into freezer and Out of freezer (migration 20261125000200).

begin;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000fc0a1', 'pf-admin@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-0000000fc0a1', 'PF Admin', 'admin');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000fc0a1","role":"authenticated"}';

select lives_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2099-11-02', 'adjustment', 'freezer_in', 'income', -21.52, 'damaged box') $$, 'an adjustment to Into freezer');
select lives_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2099-11-02', 'adjustment', 'freezer_out', 'income', 5, 'rounding') $$, 'an adjustment to Out of freezer');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2099-11-02', 'adjustment', 'freezer_in', 'expense', 5, 'wrong side') $$, '23514', null, 'they are income lines');
select throws_ok($$ insert into public.pnl_adjustments (week_id, kind, line_key, side, amount, reason)
  values ('2099-11-02', 'adjustment', 'freezer', 'income', 5, 'no such line') $$, '23514', null, 'only the known lines');

select * from finish();
rollback;
