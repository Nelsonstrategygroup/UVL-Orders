-- Owners (migration 20261121000100): Kathy Panner and Eric Freepons to start
-- (Eric with no login); only an owner can mark a week reviewed; an admin who
-- isn't an owner can't, but can still close a week.

begin;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000fa01', 'own-owner@test.local'),
  ('00000000-0000-4000-8000-00000000fa02', 'own-admin@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000fa01', 'OWN Owner', 'admin'),
  ('00000000-0000-4000-8000-00000000fa02', 'OWN Admin', 'admin');

select is((select string_agg(name || ' ' || coalesce(profile_id::text, 'no login'), ', ' order by sort) from public.pnl_owners),
  'Kathy Panner no login, Eric Freepons no login', 'the two owners to start (no users in the test database)');
insert into public.pnl_owners (name, profile_id) values ('OWN Owner', '00000000-0000-4000-8000-00000000fa01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000fa01","role":"authenticated"}';
select lives_ok($$ select public.review_pnl_week('2099-02-02', true) $$, 'an owner marks the week reviewed');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000fa02","role":"authenticated"}';
select throws_ok($$ select public.review_pnl_week('2099-02-02', true) $$, '42501', null, 'an admin who isn''t an owner can''t');
select lives_ok($$ select public.close_pnl_week('2099-02-02', '{}', '{}') $$, 'but can still close the week');
select is((select count(*)::int from public.pnl_owners), 3, 'admins see the owners');

select * from finish();
rollback;
