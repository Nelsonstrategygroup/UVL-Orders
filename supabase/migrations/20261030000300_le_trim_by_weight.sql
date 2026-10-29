-- Le Trim by weight, and extra lambs on the week (change request 10/29/26).
--
-- 1. Two settings for Le Trim by weight (Setup > Le Trim): the average
--    boneless shoulder (5 lb) and the average boneless leg (6.5 lb; Le Trim
--    uses half legs, 3.25 lb each). Trim per lamb is the Trim part's per-lamb
--    figure (Setup > Parts, 5 lb). OPEN: the 5 lb shoulder isn't confirmed
--    (Kathy has used 5; Chris saw about 4 with lighter lambs on 10/26).
--    The two old settings (trim with each shoulder / half leg) are no longer
--    used; a later cleanup drops them.
-- 2. week_extra_lambs: lambs Kathy adds to a week for any reason (Le Trim,
--    freezer stock, small lambs, half and whole orders, other), with an
--    optional note. They go on top of the count from orders; once the week
--    has a cut sheet, Kathy puts them in her sets herself. Their parts are
--    supply in the carcass balance like any other lamb's.
-- Nothing here touches orders or order lines.
-- Undo: supabase/rollback/20261030000300_revert.sql

alter table public.app_settings
  add column le_trim_shoulder_lb numeric not null default 5 check (le_trim_shoulder_lb > 0),
  add column le_trim_leg_lb numeric not null default 6.5 check (le_trim_leg_lb > 0);
comment on column public.app_settings.le_trim_shoulder_lb is
  'Average boneless shoulder (lb), for Le Trim by weight. OPEN: 5 not confirmed (Chris saw about 4 on 10/26).';
comment on column public.app_settings.le_trim_leg_lb is
  'Average boneless leg (lb); Le Trim uses half legs (half of this).';
comment on column public.app_settings.le_trim_shoulder_trim_lb is 'No longer used (10/29/26); replaced by le_trim_shoulder_lb.';
comment on column public.app_settings.le_trim_half_leg_trim_lb is 'No longer used (10/29/26); replaced by le_trim_leg_lb.';

create table public.week_extra_lambs (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete cascade,
  lambs int not null check (lambs between 1 and 500),
  reason text not null check (reason in ('le_trim', 'freezer', 'small_lambs', 'half_whole', 'other')),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index week_extra_lambs_week on public.week_extra_lambs (week_id);
comment on table public.week_extra_lambs is
  'Lambs added to a week on top of the count from orders, with a reason. Their parts count as supply in the carcass balance.';

create trigger week_extra_lambs_updated_at before update on public.week_extra_lambs
  for each row execute function public.set_updated_at();
create trigger week_extra_lambs_audit after insert or update or delete on public.week_extra_lambs
  for each row execute function public.audit_row();

alter table public.week_extra_lambs enable row level security;
create policy "week_extra_lambs: read" on public.week_extra_lambs for select to authenticated
  using ((select public.can_view_any(array['week', 'orders', 'calls', 'packing', 'cutsheet', 'downloads'])));
create policy "week_extra_lambs: change" on public.week_extra_lambs for all to authenticated
  using ((select public.can_change('week') or public.can_change('cutsheet')))
  with check ((select public.can_change('week') or public.can_change('cutsheet')));
revoke all on public.week_extra_lambs from anon;
grant select, insert, update, delete on public.week_extra_lambs to authenticated;
grant all on public.week_extra_lambs to service_role;

alter publication supabase_realtime add table public.week_extra_lambs;
