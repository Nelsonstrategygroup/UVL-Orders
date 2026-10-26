-- The Le Trim plan (change request 10/25/26). Le Trim is made from what's
-- left over: boned-out shoulders and half legs, each with trim. Kathy decides
-- the mix by hand each week after the other orders are in; the app records
-- it, takes it out of that week's extras, and puts it on the cut sheet. It
-- never changes the lamb count.
--
-- 1. Two settings, changeable in Setup: trim lb per shoulder component and
--    per half-leg component. Only used to estimate the trim Kathy will need;
--    she enters what she actually used (Lucas, 10/25/26: still to confirm
--    with Kathy).
-- 2. le_trim_plans: one per week. What she used (shoulders, half legs, trim
--    lb), the trim the app estimated was spare, the actual figure from the
--    kill sheet once she has it, and who saved it when. Kept every week, so
--    the history shows what's routine.
-- Undo: supabase/rollback/20261025000100_revert.sql

alter table public.app_settings
  add column le_trim_shoulder_trim_lb numeric not null default 5 check (le_trim_shoulder_trim_lb >= 0),
  add column le_trim_half_leg_trim_lb numeric not null default 6.5 check (le_trim_half_leg_trim_lb >= 0);

create table public.le_trim_plans (
  week_id date primary key references public.weeks (id) on delete cascade,
  shoulders int not null default 0 check (shoulders >= 0),
  half_legs int not null default 0 check (half_legs >= 0),
  -- Whole legs halved: two half legs per leg.
  legs int generated always as ((half_legs + 1) / 2) stored,
  trim_lb numeric not null default 0 check (trim_lb >= 0),
  -- Trim the app estimated was spare when this was saved (5 lb a lamb, less other orders).
  trim_estimated_lb numeric,
  -- From the kill sheet, once Kathy has it; null while it's only the estimate.
  trim_actual_lb numeric check (trim_actual_lb >= 0),
  saved_by uuid references public.profiles (id) default auth.uid(),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.le_trim_plans enable row level security;
create policy "le_trim_plans: read" on public.le_trim_plans for select to authenticated
  using ((select public.can_view_any(array['week', 'cutsheet', 'orders', 'calls'])));
create policy "le_trim_plans: change" on public.le_trim_plans for all to authenticated
  using ((select public.can_change('week') or public.can_change('cutsheet')))
  with check ((select public.can_change('week') or public.can_change('cutsheet')));
revoke all on public.le_trim_plans from anon;
grant select, insert, update, delete on public.le_trim_plans to authenticated, service_role;

create trigger le_trim_plans_updated_at before update on public.le_trim_plans
  for each row execute function public.set_updated_at();
create trigger le_trim_plans_audit after insert or update or delete on public.le_trim_plans
  for each row execute function public.audit_row('week_id');

alter publication supabase_realtime add table public.le_trim_plans;
