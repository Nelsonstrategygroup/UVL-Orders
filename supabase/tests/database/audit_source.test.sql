-- Where a change came from, in the audit log (migration 20261110000100): the
-- app's x-uvl-action request header, a database function's uvl.source first,
-- blank when neither is given, and a bad header never stops the change.

begin;
select plan(6);

create function pg_temp.last_source(p_id text) returns text language sql as $$
  select source from public.audit_log where table_name = 'customers' and row_id = p_id order by id desc limit 1 $$;

set local request.headers = '{"x-uvl-action": "weigh panel (Packing)", "content-type": "application/json"}';
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000a5c01', 'Audit Source Store');
select is(pg_temp.last_source('00000000-0000-4000-8000-0000000a5c01'), 'weigh panel (Packing)', 'the app''s header is the source');

set local uvl.source = 'invoice sync';
update public.customers set notes = 'one' where id = '00000000-0000-4000-8000-0000000a5c01';
select is(pg_temp.last_source('00000000-0000-4000-8000-0000000a5c01'), 'invoice sync', 'a database function''s own source comes first');

set local uvl.source = '';
set local request.headers = '{"content-type": "application/json"}';
update public.customers set notes = 'two' where id = '00000000-0000-4000-8000-0000000a5c01';
select is(pg_temp.last_source('00000000-0000-4000-8000-0000000a5c01'), null, 'no source given: blank');

set local request.headers = 'not json';
update public.customers set notes = 'three' where id = '00000000-0000-4000-8000-0000000a5c01';
select is((select notes from public.customers where id = '00000000-0000-4000-8000-0000000a5c01'), 'three', 'a bad header never stops the change');
select is(pg_temp.last_source('00000000-0000-4000-8000-0000000a5c01'), null, '... and leaves the source blank');

set local request.headers = '{"x-uvl-action": "box removed"}';
delete from public.customers where id = '00000000-0000-4000-8000-0000000a5c01';
select is((select source from public.audit_log where table_name = 'customers' and row_id = '00000000-0000-4000-8000-0000000a5c01' and action = 'delete'), 'box removed', 'a delete records its source too');

select * from finish();
rollback;
