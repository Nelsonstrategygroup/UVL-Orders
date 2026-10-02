-- Foundation: shared trigger functions, profiles, app settings, audit log.
-- Every table gets RLS enabled and its policies in the same migration that creates it.

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

-- Keeps updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (4.7). Readable by admins only. Rows are written by the trigger
-- below, never directly by users.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  user_id uuid default auth.uid(),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index audit_log_table_row_idx on public.audit_log (table_name, row_id);
create index audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;

-- Generic audit trigger. Trigger arguments name the primary key columns
-- (default 'id'); composite keys are joined with ':'.
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

-- ---------------------------------------------------------------------------
-- Profiles (4.1). One row per login. Admins create these from the Users screen.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null check (role in ('admin', 'office', 'packing')),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.profiles enable row level security;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row();

-- Role helpers used by every policy. security definer so they can read
-- profiles without tripping profiles' own RLS.

-- The current user's role, or null if they have no profile or are inactive.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active;
$$;

-- admin or office: full access to business tables.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() in ('admin', 'office'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() = 'admin', false);
$$;

-- Any active user (admin, office, or packing).
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_role() is not null;
$$;

-- Called by the login server action right after a successful sign-in.
-- Stamps last_login_at on the caller's own profile (so the audit log shows
-- who logged in) and returns false if the person is inactive or has no profile.
create or replace function public.record_login()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_active boolean;
begin
  update public.profiles set last_login_at = now()
  where id = auth.uid() and active
  returning true into found_active;
  return coalesce(found_active, false);
end;
$$;

revoke execute on function public.app_role(), public.is_staff(), public.is_admin(), public.is_active_user(), public.record_login() from public, anon;
grant execute on function public.app_role(), public.is_staff(), public.is_admin(), public.is_active_user(), public.record_login() to authenticated;
revoke execute on function public.audit_row(), public.set_updated_at() from public, anon, authenticated;

-- Everyone can read their own profile (so the app can tell an inactive user
-- why they were signed out). Active users can read everyone's profile, so
-- the Packing screen can show who packed an order.
create policy "profiles: read own or any if active" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_active_user());

create policy "profiles: admin insert" on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy "profiles: admin update" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profiles: admin delete" on public.profiles
  for delete to authenticated using (public.is_admin());

create policy "audit_log: admin read" on public.audit_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- App settings (4.1). Single row.
-- ---------------------------------------------------------------------------

create table public.app_settings (
  id boolean primary key default true check (id),
  processor_name text not null default 'Mohawk',
  processor_email text not null default '',
  standing_instructions text not null default '',
  company_name text not null default 'Umpqua Valley Lamb',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.app_settings enable row level security;

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_row();

insert into public.app_settings default values;

create policy "app_settings: staff read" on public.app_settings
  for select to authenticated using (public.is_staff());
create policy "app_settings: admin update" on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants. RLS decides what each row allows; anon gets nothing.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.app_settings, public.audit_log from anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, update on public.app_settings to authenticated;
grant select on public.audit_log to authenticated;
