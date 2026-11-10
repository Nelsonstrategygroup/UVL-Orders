-- Where a change came from, in the audit log (Lucas, 11/10/26, after
-- Redmond's typed-in box on INV# 3003 had no pallet and the log couldn't say
-- which screen made it).
--
-- audit_log.source: the screen or action, in plain words ("weigh panel",
-- "scan", "move to another pallet"). The app sends it with each request as
-- the x-uvl-action header (PostgREST puts request headers in
-- request.headers); a database function can set uvl.source instead. Blank
-- for changes made before 11/10/26 and for ones with no source given.
-- Nothing else changes: the trigger still records who, when, and the row
-- before and after.

alter table public.audit_log add column source text;
comment on column public.audit_log.source is 'Which screen or action made the change ("weigh panel", "scan", "type in from paper"). From the app''s x-uvl-action request header, or uvl.source set by a database function. Blank before 11/10/26.';

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
  src text;
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

  -- Where it came from: a database function's own note first, else the app's
  -- request header. A bad header never stops the change.
  src := nullif(current_setting('uvl.source', true), '');
  if src is null then
    begin
      src := nullif(left(btrim(current_setting('request.headers', true)::jsonb ->> 'x-uvl-action'), 80), '');
    exception when others then
      src := null;
    end;
  end if;

  insert into public.audit_log (table_name, row_id, action, old_data, new_data, user_id, source)
  values (tg_table_name, rid, lower(tg_op), old_j, new_j, auth.uid(), src);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.audit_row() from public, anon, authenticated;
