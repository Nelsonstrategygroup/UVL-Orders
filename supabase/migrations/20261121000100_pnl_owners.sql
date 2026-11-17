-- Owners (Lucas, 11/17/26): who reviews the Weekly P&L. "Reviewed by" lists
-- the owners only, and only an owner can mark a week "Reviewed by me". An
-- owner is a user, or a name for someone with no login yet (Eric Freepons);
-- when they get a login, the name is linked to their user. Set in Setup >
-- P&L Setup > Owners. Any admin can still close and reopen a week.
--
-- Adds pnl_owners (seeded with Kathy Panner and Eric Freepons) and changes
-- review_pnl_week() to check for an owner instead of an admin. One foreign
-- key (pnl_owners -> profiles; the first between them).
--
-- Undo: supabase/rollback/20261121000100_revert.sql

create table public.pnl_owners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  -- Their user, once they have a login.
  profile_id uuid unique references public.profiles (id) on delete set null,
  sort int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.pnl_owners is
  'The owners, who review the Weekly P&L. profile_id: their user (blank: no login yet).';

create trigger pnl_owners_updated_at before update on public.pnl_owners
  for each row execute function public.set_updated_at();
create trigger pnl_owners_audit after insert or update or delete on public.pnl_owners
  for each row execute function public.audit_row();
alter table public.pnl_owners enable row level security;
create policy "pnl_owners: admin" on public.pnl_owners for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.pnl_owners from anon;
grant select, insert, update, delete on public.pnl_owners to authenticated;
grant all on public.pnl_owners to service_role;
alter publication supabase_realtime add table public.pnl_owners;

insert into public.pnl_owners (name, profile_id, sort)
select 'Kathy Panner', (select id from public.profiles where display_name = 'Kathy Panner' limit 1), 1
union all
select 'Eric Freepons', (select id from public.profiles where display_name = 'Eric Freepons' limit 1), 2;

-- Is the signed-in person an owner?
create or replace function public.is_pnl_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pnl_owners where profile_id = auth.uid());
$$;
revoke execute on function public.is_pnl_owner() from public, anon;
grant execute on function public.is_pnl_owner() to authenticated;

-- "Reviewed by me": owners only (as in 20261116000100, with that check).
create or replace function public.review_pnl_week(p_week date, p_reviewed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_pnl_owner() then
    raise exception 'Only an owner can mark the week reviewed (Setup > P&L Setup > Owners).' using errcode = '42501';
  end if;
  if p_reviewed then
    insert into public.pnl_week_reviews (week_id, user_id, name)
    values (p_week, auth.uid(), public.pnl_my_name())
    on conflict (week_id, user_id) do nothing;
  else
    delete from public.pnl_week_reviews where week_id = p_week and user_id = auth.uid();
  end if;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.pnl_week_events (week_id, action, by_user, by_name)
    values (p_week, case when p_reviewed then 'reviewed' else 'review_removed' end, auth.uid(), public.pnl_my_name());
  end if;
end;
$$;

