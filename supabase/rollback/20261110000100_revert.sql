-- Undo 20261110000100_audit_source.sql: the audit log stops recording where a
-- change came from, and the source column (with what it recorded) is dropped.
-- Who, when, and the row before and after are kept as always.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261110000100_revert.sql

begin;

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
  old_j jsonb := null;
  new_j jsonb := null;
  key_cols text[];
  rid text;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_j := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_j := to_jsonb(new); end if;

  -- Skip updates that changed nothing but updated_at.
  if tg_op = 'UPDATE' and (old_j - 'updated_at') = (new_j - 'updated_at') then
    return new;
  end if;

  rec := coalesce(new_j, old_j);
  if tg_nargs > 0 then
    key_cols := tg_argv;
  else
    key_cols := array['id'];
  end if;
  select string_agg(rec ->> k, ':') into rid from unnest(key_cols) as k;

  insert into public.audit_log (table_name, row_id, action, old_data, new_data, user_id)
  values (tg_table_name, rid, lower(tg_op), old_j, new_j, auth.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.audit_row() from public, anon, authenticated;

alter table public.audit_log drop column if exists source;

delete from supabase_migrations.schema_migrations where version = '20261110000100';

commit;
