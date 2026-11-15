-- Lamb cost, stage 1 (migration 20261114000100): producers, pricing
-- settings and producer rates. Admins only; every other role sees nothing.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c0a1', 'lc-admin@test.local'),
  ('00000000-0000-4000-8000-00000000c0a2', 'lc-packing@test.local'),
  ('00000000-0000-4000-8000-00000000c0a3', 'lc-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000c0a1', 'LC Admin', 'admin'),
  ('00000000-0000-4000-8000-00000000c0a2', 'LC Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000c0a3', 'LC Office', 'office');

select is((select count(*)::int from public.producers), 0, 'no producers are seeded');
select is((select count(*)::int from public.lamb_cost_settings), 0, 'no pricing setting is seeded');

set local role authenticated;

-- Admin: adds and changes everything.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a1","role":"authenticated"}';
select lives_ok($$ insert into public.producers (id, name, ranch_name) values ('00000000-0000-4000-8000-00000000c0b1', 'LC Producer', 'LC Ranch') $$,
  'an admin adds a producer');
select throws_ok($$ insert into public.producers (name) values ('  ') $$, '23514', null, 'a producer needs a name');
select lives_ok($$ insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2099-01-01', 3.00, 2.02) $$,
  'an admin adds a pricing setting');
select throws_ok($$ insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2099-01-01', 3.10, 2.02) $$,
  '23505', null, 'one setting per start date');
select throws_ok($$ insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2099-02-01', 3.10, 0) $$,
  '23514', null, 'the factor must be above 0');
select throws_ok($$ insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2099-02-01', -1, 2.02) $$,
  '23514', null, 'the rate can''t be negative');
select lives_ok($$ insert into public.producer_rates (producer_id, effective_from, rate) values ('00000000-0000-4000-8000-00000000c0b1', '2099-01-01', 3.25) $$,
  'an admin adds a producer rate');
select throws_ok($$ insert into public.producer_rates (producer_id, effective_from, rate) values ('00000000-0000-4000-8000-00000000c0b1', '2099-01-01', 3.30) $$,
  '23505', null, 'one producer rate per start date');
select lives_ok($$ update public.producers set active = false where id = '00000000-0000-4000-8000-00000000c0b1' $$, 'an admin turns a producer off');

-- Packing and Office: see nothing, change nothing.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a2","role":"authenticated"}';
select is((select count(*)::int from public.producers), 0, 'packing sees no producers');
select is((select count(*)::int from public.lamb_cost_settings), 0, 'packing sees no pricing settings');
select throws_ok($$ insert into public.producers (name) values ('Sneaky') $$, '42501', null, 'packing can''t add a producer');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a3","role":"authenticated"}';
select is((select count(*)::int from public.producer_rates), 0, 'office sees no producer rates');
select throws_ok($$ insert into public.lamb_cost_settings (effective_from, base_rate, live_factor) values ('2099-03-01', 1, 1) $$,
  '42501', null, 'office can''t add a pricing setting');

reset role;
select is((select count(*)::int from public.audit_log where table_name in ('producers', 'lamb_cost_settings', 'producer_rates')
  and user_id = '00000000-0000-4000-8000-00000000c0a1'), 4, 'every admin change is in the audit log');

select * from finish();
rollback;
