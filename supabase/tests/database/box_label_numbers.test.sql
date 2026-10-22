-- Label numbers and printing (change request 10/23/26): numbers in report
-- order, stable when an order changes, the print log, and who may do it.

begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000008a1', 'bl-office@test.local'),
  ('00000000-0000-4000-8000-0000000008b2', 'bl-viewer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000008a1', 'Kathy', 'office'),
  ('00000000-0000-4000-8000-0000000008b2', 'Viewer', 'viewer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}';

select is(
  (select string_agg(key || '=' || number, ',' order by number)
   from public.assign_box_labels('2099-05-04', array['a|legs|1', 'a|legs|2', 'b|legs|1'])),
  'a|legs|1=1,a|legs|2=2,b|legs|1=3', 'numbers go out in report order');

-- An order changes: a's legs need one box, and c is new. b keeps 3; c gets 4.
select is(
  (select string_agg(key || '=' || number, ',' order by number)
   from public.assign_box_labels('2099-05-04', array['a|legs|1', 'b|legs|1', 'c|legs|1'])),
  'a|legs|1=1,b|legs|1=3,c|legs|1=4', 'other labels keep their numbers; a new box gets the next number');
select is((select count(*)::int from public.box_labels where week_id = '2099-05-04'), 4,
  'a number given out is never reused (a''s second box keeps 2, unused)');

select lives_ok($$ select public.record_label_print('2099-05-04', '[{"number": 1, "print": "p1"}, {"number": 3, "print": "p3"}]') $$,
  'print labels 1 and 3');
select is(
  (select string_agg(number || ':' || printed_print || ':' || (printed_by is not null), ',' order by number)
   from public.box_labels where week_id = '2099-05-04' and printed_at is not null),
  '1:p1:true,3:p3:true', 'printed labels remember what they said and who printed them');
select lives_ok($$ select public.record_label_print('2099-05-04', '[{"number": 3, "print": "p3b"}]') $$, 'reprint label 3');
select is(
  (select string_agg(number || ':' || reprint, ',' order by printed_at, number) from public.label_prints where week_id = '2099-05-04'),
  '1:false,3:false,3:true', 'the log keeps first prints and reprints');
select is(
  (select printed_print from public.assign_box_labels('2099-05-04', array['b|legs|1'])), 'p3b',
  'the report gets the last print back with the number');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000008b2","role":"authenticated"}';
select throws_ok($$ select public.assign_box_labels('2099-05-04', array['z|legs|1']) $$, '42501', null,
  'someone who can only look can''t number labels');

select * from finish();
rollback;
