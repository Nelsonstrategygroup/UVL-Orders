-- Le Trim by weight and extra lambs (migration 20261030000300).

begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000b6a1', 'extra-office@test.local'),
  ('00000000-0000-4000-8000-00000000b6a2', 'extra-packer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000b6a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-00000000b6a2', 'Packer', 'packing');
insert into public.role_permissions (role, area, level) values ('office', 'week', 2)
  on conflict (role, area) do update set level = excluded.level;
insert into public.weeks (id) values ('2099-12-14');

select is((select le_trim_shoulder_lb::text || ' ' || le_trim_leg_lb::text from public.app_settings), '5 6.5', 'the averages start at 5 lb and 6.5 lb');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b6a1","role":"authenticated"}';
select lives_ok($$ insert into public.week_extra_lambs (week_id, lambs, reason) values ('2099-12-14', 16, 'le_trim') $$, 'whoever changes the week adds extra lambs');
select throws_ok($$ insert into public.week_extra_lambs (week_id, lambs, reason) values ('2099-12-14', 0, 'le_trim') $$, '23514', null, 'at least one lamb');
select throws_ok($$ insert into public.week_extra_lambs (week_id, lambs, reason) values ('2099-12-14', 3, 'because') $$, '23514', null, 'a reason from the list');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000b6a2","role":"authenticated"}';
select is((select count(*)::text from public.week_extra_lambs where week_id = '2099-12-14'), '1', 'packing sees them');
select throws_ok($$ insert into public.week_extra_lambs (week_id, lambs, reason) values ('2099-12-14', 2, 'other') $$, '42501', null, 'packing can''t add them');

select * from finish();
rollback;
