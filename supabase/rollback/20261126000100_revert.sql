-- Undo 20261126000100_ask_readers.sql: removes the Ask views, their
-- bookkeeping and the reader roles. Touches nothing else.
drop trigger if exists role_permissions_ask_grants on public.role_permissions;
drop schema if exists ai cascade;
drop schema if exists ai_private cascade;
do $$
declare r text;
begin
  foreach r in array array['ai_reader_admin', 'ai_reader_office', 'ai_reader_packing',
                           'ai_reader_viewer', 'ai_reader_billing'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('drop owned by %I', r);
      execute format('drop role %I', r);
    end if;
  end loop;
end $$;
delete from supabase_migrations.schema_migrations where version = '20261126000100';
