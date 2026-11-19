-- Lamb cost, stage 2 (migration 20261114000200): weigh sheets, carcass
-- weights, adjustments and photo records. Admins only; the rate and factor
-- are stored on the sheet and never follow later Setup changes.

begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d0a1', 'ws-admin@test.local'),
  ('00000000-0000-4000-8000-00000000d0a2', 'ws-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000d0a1', 'WS Admin', 'admin'),
  ('00000000-0000-4000-8000-00000000d0a2', 'WS Office', 'office');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d0a1","role":"authenticated"}';

insert into public.producers (id, name) values
  ('00000000-0000-4000-8000-00000000d0b1', 'WS Producer A'),
  ('00000000-0000-4000-8000-00000000d0b2', 'WS Producer B');
insert into public.producer_rates (producer_id, effective_from, rate) values
  ('00000000-0000-4000-8000-00000000d0b2', '2026-11-01', 3.25);

-- Rates
select throws_ok($$ insert into public.kill_sheets (producer_id, kill_date) values ('00000000-0000-4000-8000-00000000d0b1', '2026-09-15') $$,
  'P0001', null, 'no sheet before the first pricing setting');
select lives_ok($$ insert into public.kill_sheets (id, producer_id, kill_date) values
  ('00000000-0000-4000-8000-00000000d0c1', '00000000-0000-4000-8000-00000000d0b1', '2026-10-23') $$, 'an admin adds a sheet');
select is((select base_rate::text || ' ' || live_factor::text || ' ' || rate_source from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c1'),
  '3.0000 2.0200 base', 'a sheet takes the base rate and factor on its kill date');
select is((select week_id::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c1'), '2026-10-26',
  'a Friday kill belongs to the next packing Monday');
select throws_ok($$ insert into public.kill_sheets (producer_id, kill_date) values ('00000000-0000-4000-8000-00000000d0b1', '2026-10-23') $$,
  '23505', null, 'one sheet per producer per kill date');
select lives_ok($$ insert into public.kill_sheets (id, producer_id, kill_date) values
  ('00000000-0000-4000-8000-00000000d0c2', '00000000-0000-4000-8000-00000000d0b2', '2026-11-11') $$, 'a second producer''s sheet');
select is((select base_rate::text || ' ' || rate_source from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c2'),
  '3.2500 producer', 'a producer''s own rate is used when one applies');
select is((select week_id::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c2'), '2026-11-09',
  'a Wednesday kill belongs to that week''s Monday');

-- A setting covering the kill date reaches the sheet (11/18/26; producer_pay_settings.test.sql has the rest).
insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2026-10-15', 3.10, 2.05);
select is((select base_rate::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c1'), '3.1000',
  'a setting covering the kill date reaches the sheet');
select lives_ok($$ update public.kill_sheets set notes = 'checked' where id = '00000000-0000-4000-8000-00000000d0c1' $$, 'a note can be added');
select is((select base_rate::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c1'), '3.1000',
  'changing the note keeps the rate');
select lives_ok($$ select public.use_setup_rates('00000000-0000-4000-8000-00000000d0c1') $$, 'use today''s Setup rates');
select is((select base_rate::text || ' ' || live_factor::text from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c1'),
  '3.1000 2.0500', 'the sheet now has the Setup rates for its date');
select lives_ok($$ update public.kill_sheets set producer_id = '00000000-0000-4000-8000-00000000d0b2', kill_date = '2026-11-12'
  where id = '00000000-0000-4000-8000-00000000d0c1' $$, 'a sheet''s producer and date can be corrected');
select is((select base_rate::text || ' ' || rate_source from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c1'),
  '3.2500 producer', 'correcting the producer takes their rate again');

-- Weights
select lives_ok($$ insert into public.kill_lambs (id, sheet_id, position, carcass_lb) values
  ('00000000-0000-4000-8000-00000000d0e1', '00000000-0000-4000-8000-00000000d0c2', 1, 62.4),
  ('00000000-0000-4000-8000-00000000d0e2', '00000000-0000-4000-8000-00000000d0c2', 2, 58.0),
  ('00000000-0000-4000-8000-00000000d0e3', '00000000-0000-4000-8000-00000000d0c2', 21, 71.2) $$, 'weights go in, the 21st at the top of column 2');
select throws_ok($$ insert into public.kill_lambs (sheet_id, position, carcass_lb) values ('00000000-0000-4000-8000-00000000d0c2', 1, 60) $$,
  '23505', null, 'one weight per place on the sheet');
select throws_ok($$ insert into public.kill_lambs (sheet_id, position, carcass_lb) values ('00000000-0000-4000-8000-00000000d0c2', 3, 0) $$,
  '23514', null, 'a weight is above 0');
select lives_ok($$ update public.kill_lambs set carcass_lb = 58.5 where id = '00000000-0000-4000-8000-00000000d0e2' $$, 'a weight can be changed');
select is((select (old_data ->> 'carcass_lb') || ' -> ' || (new_data ->> 'carcass_lb') from public.audit_log
  where table_name = 'kill_lambs' and action = 'update' and row_id = '00000000-0000-4000-8000-00000000d0e2'), '58.00 -> 58.50',
  'the change is logged with the old value');
select is((select user_id::text from public.audit_log where table_name = 'kill_lambs' and action = 'update'
  and row_id = '00000000-0000-4000-8000-00000000d0e2'), '00000000-0000-4000-8000-00000000d0a1', 'and who made it');

-- Adjustments
select lives_ok($$ insert into public.kill_adjustments (sheet_id, lamb_id, kind, amount, reason) values
  ('00000000-0000-4000-8000-00000000d0c2', '00000000-0000-4000-8000-00000000d0e1', 'dollars', -10, 'dock') $$, 'a dock on one lamb');
select lives_ok($$ insert into public.kill_adjustments (sheet_id, kind, amount, reason) values
  ('00000000-0000-4000-8000-00000000d0c2', 'per_live_lb', 0.05, 'premium') $$, 'a premium per live lb on the whole sheet');
select throws_ok($$ insert into public.kill_adjustments (sheet_id, kind, amount, reason) values
  ('00000000-0000-4000-8000-00000000d0c2', 'dollars', 25, 'other') $$, '23514', null, '"other" needs a note');
select throws_ok($$ insert into public.kill_adjustments (sheet_id, lamb_id, kind, amount, reason) values
  ('00000000-0000-4000-8000-00000000d0c1', '00000000-0000-4000-8000-00000000d0e1', 'dollars', 5, 'premium') $$,
  '23503', null, 'a lamb''s adjustment must be on that lamb''s sheet');

-- Office sees nothing.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d0a2","role":"authenticated"}';
select is((select count(*)::int from public.kill_sheets), 0, 'office sees no sheets');
select is((select count(*)::int from public.kill_lambs), 0, 'office sees no weights');

-- Deleting a sheet takes its weights and adjustments with it.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d0a1","role":"authenticated"}';
select lives_ok($$ delete from public.kill_sheets where id = '00000000-0000-4000-8000-00000000d0c2' $$, 'an admin deletes a sheet');

select * from finish();
rollback;
