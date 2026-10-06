-- The database never leaves the app without an active admin.

begin;
select plan(6);

-- Start from a known state: no other admins are active in this transaction
-- (all rolled back at the end).
alter table public.profiles disable trigger profiles_keep_an_admin;
update public.profiles set active = false where role = 'admin';
alter table public.profiles enable trigger profiles_keep_an_admin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a7', 'ka-one@test.local'),
  ('00000000-0000-4000-8000-0000000000a8', 'ka-two@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a7', 'Admin One', 'admin'),
  ('00000000-0000-4000-8000-0000000000a8', 'Admin Two', 'admin');

select lives_ok(
  $$ update public.profiles set active = false where id = '00000000-0000-4000-8000-0000000000a8' $$,
  'one of two admins can be turned off');
select throws_ok(
  $$ update public.profiles set active = false where id = '00000000-0000-4000-8000-0000000000a7' $$,
  '23514', null, 'the last active admin cannot be turned off');
select throws_ok(
  $$ update public.profiles set role = 'office' where id = '00000000-0000-4000-8000-0000000000a7' $$,
  '23514', null, 'the last active admin cannot become office');
select throws_ok(
  $$ delete from auth.users where id = '00000000-0000-4000-8000-0000000000a7' $$,
  '23514', null, 'the last active admin''s login cannot be deleted');
select lives_ok(
  $$ update public.profiles set display_name = 'Admin 1', last_login_at = now() where id = '00000000-0000-4000-8000-0000000000a7' $$,
  'other changes to the last admin still work');
update public.profiles set active = true where id = '00000000-0000-4000-8000-0000000000a8';
select lives_ok(
  $$ update public.profiles set role = 'office' where id = '00000000-0000-4000-8000-0000000000a7' $$,
  'with a second active admin, the first can change role');

select * from finish();
rollback;
