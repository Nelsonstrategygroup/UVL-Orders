-- 11/12/26: products.draws_from (Mixed Shanks is cut from front or hind
-- shanks) and weeks.no_processing (a holiday week), migrations
-- 20261112000100 and 20261112000200.

begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000d0f01', 'weekoff-office@test.local');
insert into public.profiles (id, display_name, role) values ('00000000-0000-4000-8000-0000000d0f01', 'Office', 'office');
insert into public.products (id, name, unit, group_name, price_unit) values ('df-rack', 'DF Racks', 'each', 'Other', 'lb');

select is((select cardinality(draws_from) from public.products where id = 'df-rack'), 0, 'a product draws from no parts unless set');
update public.products set draws_from = array['fshank', 'hshank'] where id = 'df-rack';
select is((select array_length(draws_from, 1) from public.products where id = 'df-rack'), 2, 'the parts it may be cut from are kept');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0f01","role":"authenticated"}';
insert into public.weeks (id) values ('2099-11-23') on conflict do nothing;
select ok(not (select no_processing from public.weeks where id = '2099-11-23'), 'a week has processing unless marked');
update public.weeks set no_processing = true, no_processing_note = 'Thanksgiving' where id = '2099-11-23';
select is((select no_processing_note from public.weeks where id = '2099-11-23' and no_processing), 'Thanksgiving', 'office can mark a week No processing, with a note');
update public.weeks set no_processing = false, no_processing_note = '' where id = '2099-11-23';
select ok(not (select no_processing from public.weeks where id = '2099-11-23'), 'and turn it back on');
reset role;
select is((select count(*)::int from public.audit_log where table_name = 'weeks' and row_id = '2099-11-23' and action = 'update'), 2, 'both changes are in the audit log');

select * from finish();
rollback;
