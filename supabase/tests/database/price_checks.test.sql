-- Prices confirmed (migration 20261114000500): one row per location, who
-- checked it and when, billing changes it, packing can't see it.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c1a1', 'chk-billing@test.local'),
  ('00000000-0000-4000-8000-00000000c1a2', 'chk-packing@test.local'),
  ('00000000-0000-4000-8000-00000000c1a3', 'chk-office@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000c1a1', 'Check Biller', 'billing'),
  ('00000000-0000-4000-8000-00000000c1a2', 'Check Packer', 'packing'),
  ('00000000-0000-4000-8000-00000000c1a3', 'Check Office', 'office');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-00000000c1c1', 'Check Market');

select is((select count(*)::int from public.customer_price_checks c join public.customers s on s.id = c.customer_id
  join public.customers p on p.id = s.parent_customer_id where p.name = 'PCC' and not c.confirmed), 0,
  'every PCC location that has a row starts confirmed');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c1a1","role":"authenticated"}';
select lives_ok($$ insert into public.customer_price_checks (customer_id, confirmed) values ('00000000-0000-4000-8000-00000000c1c1', true) $$,
  'billing confirms a location''s prices');
select is((select changed_by_name from public.customer_price_checks where customer_id = '00000000-0000-4000-8000-00000000c1c1'),
  'Check Biller', 'who checked it is recorded');
select is((select changed_by::text from public.customer_price_checks where customer_id = '00000000-0000-4000-8000-00000000c1c1'),
  '00000000-0000-4000-8000-00000000c1a1', 'by their id');
select lives_ok($$ update public.customer_price_checks set confirmed = false, changed_by_name = 'Someone else'
  where customer_id = '00000000-0000-4000-8000-00000000c1c1' $$, 'billing unchecks it');
select is((select changed_by_name from public.customer_price_checks where customer_id = '00000000-0000-4000-8000-00000000c1c1'),
  'Check Biller', 'the name comes from the signed-in person, not what''s sent');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c1a2","role":"authenticated"}';
select is_empty($$ select 1 from public.customer_price_checks $$, 'packing can''t see it');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c1a3","role":"authenticated"}';
select isnt_empty($$ select 1 from public.customer_price_checks $$, 'office can see it');
update public.customer_price_checks set confirmed = true where customer_id = '00000000-0000-4000-8000-00000000c1c1';
reset role;
select is((select confirmed from public.customer_price_checks where customer_id = '00000000-0000-4000-8000-00000000c1c1'), false,
  'office can''t change it');

select * from finish();
rollback;
