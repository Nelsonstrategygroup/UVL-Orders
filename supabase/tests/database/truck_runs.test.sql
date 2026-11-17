-- Truck run log (migration 20261118000100): drivers and their rates (admins),
-- runs and stops (Office and Billing change them, Viewer looks, Packing sees
-- none); each run counts toward its order week; the truck categories with
-- their rates; a closed week's runs can't change.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f8a1', 'tr-admin@test.local'),
  ('00000000-0000-4000-8000-00000000f8a2', 'tr-office@test.local'),
  ('00000000-0000-4000-8000-00000000f8a3', 'tr-packer@test.local'),
  ('00000000-0000-4000-8000-00000000f8a4', 'tr-billing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000f8a1', 'TR Admin', 'admin'),
  ('00000000-0000-4000-8000-00000000f8a2', 'TR Office', 'office'),
  ('00000000-0000-4000-8000-00000000f8a3', 'TR Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000f8a4', 'TR Billing', 'billing');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000f8c1', 'TR Market');

select is((select string_agg(name || ' ' || method || coalesce(' ' || truck_part, ''), '; ' order by sort)
  from public.expense_categories where delivery_kind = 'truck'),
  'Truck, driver pay per_truck_run driver_pay; Truck, payroll taxes: SAIF percent_category; Truck, payroll taxes: FICA percent_category; '
  || 'Truck, fuel per_truck_run fuel; Truck, maintenance per_truck_run maintenance; Truck, insurance fixed_weekly; '
  || 'Truck, depreciation fixed_weekly; Truck, repairs entered',
  'the truck categories, in order');
select is((select string_agg(c.name || ' ' || coalesce(r.percent::text, r.amount::text), '; ' order by c.sort)
  from public.expense_category_rates r join public.expense_categories c on c.id = r.category_id
  where c.name in ('Truck, payroll taxes: SAIF', 'Truck, payroll taxes: FICA', 'Truck, maintenance')),
  'Truck, payroll taxes: SAIF 10.0000; Truck, payroll taxes: FICA 8.0000; Truck, maintenance 50.0000', 'their starting rates');
select ok((select base_category_ids = array[(select id from public.expense_categories where name = 'Truck, driver pay')]
  from public.expense_categories where name = 'Truck, payroll taxes: SAIF'), 'payroll taxes are a percent of driver pay only');

-- Admin: a driver and a rate.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f8a1","role":"authenticated"}';
select lives_ok($$ insert into public.truck_drivers (id, name) values ('00000000-0000-4000-8000-00000000f8d1', 'TR Driver') $$, 'an admin adds a driver');
select lives_ok($$ insert into public.truck_driver_rates (driver_id, effective_from, base, per_extra, per_skipped)
  values ('00000000-0000-4000-8000-00000000f8d1', '2026-10-08', 290, 40, 40) $$, 'and their pay rate');

-- Office: a run with stops.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f8a2","role":"authenticated"}';
select lives_ok($$ insert into public.truck_runs (id, run_date, driver_id, fuel)
  values ('00000000-0000-4000-8000-00000000f8e1', '2099-11-03', '00000000-0000-4000-8000-00000000f8d1', 112.40) $$, 'office logs a run');
select is((select week_id::text from public.truck_runs where id = '00000000-0000-4000-8000-00000000f8e1'), '2099-11-02', 'it counts toward its order week');
select lives_ok($$ insert into public.truck_run_stops (run_id, kind, customer_id, name) values
  ('00000000-0000-4000-8000-00000000f8e1', 'stop', '00000000-0000-4000-8000-00000000f8c1', 'TR Market'),
  ('00000000-0000-4000-8000-00000000f8e1', 'extra', null, 'Farm stand') $$, 'with its stops');
select throws_ok($$ insert into public.truck_run_stops (run_id, kind, name) values ('00000000-0000-4000-8000-00000000f8e1', 'maybe', 'x') $$,
  '23514', null, 'a stop is a stop, extra or skipped');
select throws_ok($$ insert into public.truck_driver_rates (driver_id, effective_from, base) values ('00000000-0000-4000-8000-00000000f8d1', '2027-01-01', 300) $$,
  '42501', null, 'office can''t change pay rates');

-- Billing can change runs; packing sees none.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f8a4","role":"authenticated"}';
select lives_ok($$ update public.truck_runs set note = 'Late start' where id = '00000000-0000-4000-8000-00000000f8e1' $$, 'billing can change a run');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f8a3","role":"authenticated"}';
select is((select count(*)::int from public.truck_runs), 0, 'packing sees no runs');
select is((select count(*)::int from public.truck_drivers), 0, 'packing sees no drivers');

-- A closed week's runs and stops can't change.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f8a1","role":"authenticated"}';
select public.close_pnl_week('2099-11-02', '{}', '{}');
select throws_ok($$ update public.truck_runs set fuel = 1 where id = '00000000-0000-4000-8000-00000000f8e1' $$, '55000', null, 'a closed week''s run');
select throws_ok($$ delete from public.truck_run_stops where name = 'Farm stand' $$, '55000', null, 'a closed week''s stop');
select throws_ok($$ insert into public.truck_runs (run_date, driver_id) values ('2099-11-04', '00000000-0000-4000-8000-00000000f8d1') $$,
  '55000', null, 'a new run dated in a closed week');

-- A customer on a run can still be deleted: the stop keeps its name.
reset role;
select public.reopen_pnl_week('2099-11-02', 'test') from (select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000f8a1","role":"authenticated"}', true)) x;
delete from public.customers where id = '00000000-0000-4000-8000-00000000f8c1';
select is((select name || ' ' || coalesce(customer_id::text, 'none') from public.truck_run_stops where kind = 'stop'), 'TR Market none',
  'a deleted customer''s stop keeps its name');

select * from finish();
rollback;
