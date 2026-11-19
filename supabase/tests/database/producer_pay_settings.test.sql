-- Producer pay follows the dated settings (migration 20261124000100; Lucas, 11/18/26).

begin;
select plan(17);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000ac01', 'pp-admin@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-00000000ac01', 'PP Admin', 'admin');
insert into public.producers (id, name) values
  ('00000000-0000-4000-8000-00000000acb1', 'PP Producer'),
  ('00000000-0000-4000-8000-00000000acb2', 'PP Other');
delete from public.kill_sheets;
delete from public.lamb_cost_settings;
insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2098-10-01', 3, 2.02);
insert into public.kill_sheets (id, producer_id, kill_date) values
  ('00000000-0000-4000-8000-00000000acc1', '00000000-0000-4000-8000-00000000acb1', '2098-10-23'),
  ('00000000-0000-4000-8000-00000000acc2', '00000000-0000-4000-8000-00000000acb1', '2098-11-13'),
  ('00000000-0000-4000-8000-00000000acc3', '00000000-0000-4000-8000-00000000acb2', '2098-11-13'),
  ('00000000-0000-4000-8000-00000000acc4', '00000000-0000-4000-8000-00000000acb2', '2098-11-06');

select is((select live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc2'), '2.0200', 'a kill starts at the setting');

-- A week closed: its kill stays.
insert into public.weeks (id) select week_id from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc4' on conflict do nothing;
insert into public.pnl_closed_weeks (week_id, snapshot) values ((select week_id from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc4'), '{}');

-- An override, with its reason.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000ac01","role":"authenticated"}';
select throws_ok($$ select public.set_sheet_override('00000000-0000-4000-8000-00000000acc3', 3.5, 2.1, ' ') $$, '22023', null, 'an override needs a reason');
select lives_ok($$ select public.set_sheet_override('00000000-0000-4000-8000-00000000acc3', 3.5, 2.1, 'Premium lot') $$, 'an override with a reason');
select is((select base_rate::text || ' ' || live_factor::text || ' ' || rate_source || ' ' || override_reason from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc3'),
  '3.5000 2.1000 override Premium lot', 'the override is on the sheet');

-- A new setting reaches the kills it covers.
insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2098-11-01', 3, 2);
select is((select live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc2'), '2.0000', 'a kill on or after the new setting follows it');
select is((select live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc1'), '2.0200', 'an earlier kill does not');
select is((select live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc3'), '2.1000', 'an override stays');
select is((select live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc4'), '2.0200', 'a kill in a closed week stays');

-- A producer's own rate.
insert into public.producer_rates (producer_id, effective_from, rate) values ('00000000-0000-4000-8000-00000000acb1', '2098-11-01', 3.25);
select is((select base_rate::text || ' ' || rate_source from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc2'), '3.2500 producer', 'a producer''s own rate reaches the kill');
delete from public.producer_rates where producer_id = '00000000-0000-4000-8000-00000000acb1';
select is((select base_rate::text || ' ' || rate_source from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc2'), '3.0000 base', 'removing it goes back to the base rate');

-- Removing a setting.
delete from public.lamb_cost_settings where effective_from = '2098-11-01';
select is((select live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc2'), '2.0200', 'the setting removed: back to the one before');
select throws_ok($$ delete from public.lamb_cost_settings where effective_from = '2098-10-01' $$, 'P0001', null, 'a kill can''t be left with no setting');

-- The numbers can't be typed over directly.
update public.kill_sheets set base_rate = 9, live_factor = 9, notes = 'x' where id = '00000000-0000-4000-8000-00000000acc1';
select is((select base_rate::text || ' ' || live_factor::text || ' ' || notes from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc1'), '3.0000 2.0200 x', 'a direct change to the rate is ignored');

-- Moving an overridden kill keeps its override; ending it goes back to the setting.
update public.kill_sheets set kill_date = '2098-11-14' where id = '00000000-0000-4000-8000-00000000acc3';
select is((select rate_source from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc3'), 'override', 'a new date keeps the override');
select lives_ok($$ select public.use_setup_rates('00000000-0000-4000-8000-00000000acc3') $$, 'back to the setting');
select is((select base_rate::text || ' ' || live_factor::text || ' ' || rate_source || ' ' || coalesce(override_reason, 'none') from public.kill_sheets where id = '00000000-0000-4000-8000-00000000acc3'),
  '3.0000 2.0200 base none', 'the override is gone');

-- A closed week's kill can't be overridden.
select throws_ok($$ select public.set_sheet_override('00000000-0000-4000-8000-00000000acc4', 3.5, 2.1, 'Too late') $$, '55000', null, 'a closed week refuses an override');

select * from finish();
rollback;
