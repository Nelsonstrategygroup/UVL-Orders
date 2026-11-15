-- Lamb cost, stage 2: weigh sheets (SPEC 16.3-16.5, Lucas's answers 11/14/26).
--
-- Only ADDS: four tables, two functions, a private photo bucket, and the
-- starting pricing setting. Changes no existing table, column or row, and
-- nothing existing reads these tables. Admins only (is_admin()). Every
-- add, change and delete is logged by the existing audit trigger (who,
-- when, old value).
--
-- One sheet per producer per kill date, like Mohawk's paper kill log. A
-- sheet belongs to the order week (Thursday to Wednesday, named by its
-- packing Monday) that contains its kill date. The rate and live factor are
-- stored on the sheet when it's made, so a later change in Setup never
-- alters a past sheet.
--
-- These tables are loaded with plain queries, never embedded: kill_adjustments
-- links to both kill_sheets and kill_lambs, which would make an embed of one
-- from the other ambiguous (see the 10/26/26 outage).
--
-- Undo: supabase/rollback/20261114000200_revert.sql

-- The starting setting (Lucas, 11/14/26): $3.00 per lb live, factor 2.02, from Oct 1, 2026.
insert into public.lamb_cost_settings (effective_from, base_rate, live_factor, note)
values ('2026-10-01', 3.00, 2.02, 'Starting rate (Lucas, 11/14/26)')
on conflict (effective_from) do nothing;

-- ---------------------------------------------------------------------------
-- The rate a producer's lambs are paid at on a date: their own rate if one
-- applies, else the base rate; the factor always from the pricing setting.
-- Same rule as rateFor() in lib/calc/lambCost.ts. No setting: an error.
-- ---------------------------------------------------------------------------
create or replace function public.lamb_cost_rates(p_producer uuid, p_date date,
  out base_rate numeric, out live_factor numeric, out rate_source text)
language plpgsql
stable
set search_path = ''
as $$
declare
  s record;
  own numeric;
begin
  select ls.base_rate, ls.live_factor into s
  from public.lamb_cost_settings ls
  where ls.effective_from <= p_date
  order by ls.effective_from desc
  limit 1;
  if not found then
    raise exception 'No pricing setting starts on or before %. Add one in Setup > Lamb cost.', to_char(p_date, 'Mon FMDD, YYYY')
      using errcode = 'P0001', hint = 'no_lamb_cost_setting';
  end if;
  select pr.rate into own
  from public.producer_rates pr
  where pr.producer_id = p_producer and pr.effective_from <= p_date
  order by pr.effective_from desc
  limit 1;
  live_factor := s.live_factor;
  if own is not null then
    base_rate := own;
    rate_source := 'producer';
  else
    base_rate := s.base_rate;
    rate_source := 'base';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sheets
-- ---------------------------------------------------------------------------
create table public.kill_sheets (
  id uuid primary key default gen_random_uuid(),
  producer_id uuid not null references public.producers (id) on delete restrict,
  kill_date date not null,
  -- The packing Monday of the Thursday-Wednesday week containing the kill
  -- date (packingMonday() in lib/dates.ts, WEEK_STARTS = Thursday).
  week_id date generated always as
    (kill_date - ((extract(dow from kill_date)::int - 4 + 7) % 7) + 4) stored,
  base_rate numeric(12, 4) not null check (base_rate >= 0),
  live_factor numeric(8, 4) not null check (live_factor > 0),
  rate_source text not null check (rate_source in ('base', 'producer')),
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (producer_id, kill_date)
);
create index kill_sheets_week on public.kill_sheets (week_id);
comment on table public.kill_sheets is
  'Lamb cost (SPEC 16.3): one of Mohawk''s kill log sheets, one producer and kill date. base_rate, live_factor and rate_source are stored when made (and when the producer or date changes) so later Setup changes never alter it.';

-- Store the rates on a new sheet, and again when its producer or kill date changes.
create or replace function public.kill_sheets_set_rates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r record;
begin
  if tg_op = 'INSERT' or new.producer_id is distinct from old.producer_id or new.kill_date is distinct from old.kill_date then
    select * into r from public.lamb_cost_rates(new.producer_id, new.kill_date);
    new.base_rate := r.base_rate;
    new.live_factor := r.live_factor;
    new.rate_source := r.rate_source;
  end if;
  return new;
end $$;

create trigger kill_sheets_rates before insert or update on public.kill_sheets
  for each row execute function public.kill_sheets_set_rates();

-- "Use today's Setup rates": take the rates again from Setup for the sheet's
-- kill date (for example after a setting was entered late). Logged.
create or replace function public.use_setup_rates(p_sheet uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare r record; s record;
begin
  select producer_id, kill_date into s from public.kill_sheets where id = p_sheet;
  if not found then
    raise exception 'That sheet is gone.';
  end if;
  select * into r from public.lamb_cost_rates(s.producer_id, s.kill_date);
  perform set_config('uvl.source', 'use Setup rates (weigh sheet)', true);
  update public.kill_sheets
  set base_rate = r.base_rate, live_factor = r.live_factor, rate_source = r.rate_source
  where id = p_sheet;
end $$;

-- ---------------------------------------------------------------------------
-- Carcass weights: one row per lamb. position is its place on the paper
-- grid (1-20 the first column, 21-40 the second, ...).
-- ---------------------------------------------------------------------------
create table public.kill_lambs (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.kill_sheets (id) on delete cascade,
  position int not null check (position between 1 and 400),
  carcass_lb numeric(7, 2) not null check (carcass_lb > 0 and carcass_lb < 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (sheet_id, position),
  unique (id, sheet_id)
);
comment on table public.kill_lambs is
  'Lamb cost (SPEC 16.3): one lamb''s carcass weight on a kill sheet, at its place on the paper grid. Every change is in the audit log.';

-- ---------------------------------------------------------------------------
-- Adjustments: on one lamb (lamb_id) or the whole sheet (lamb_id blank). A
-- dollar amount or $ per live lb, signed (a dock is negative).
-- ---------------------------------------------------------------------------
create table public.kill_adjustments (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.kill_sheets (id) on delete cascade,
  lamb_id uuid,
  kind text not null check (kind in ('dollars', 'per_live_lb')),
  amount numeric(12, 4) not null check (amount <> 0),
  reason text not null check (reason in ('premium', 'dock', 'hauling', 'other')),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (reason <> 'other' or btrim(note) <> ''),
  -- A lamb's adjustment is on that lamb's own sheet. Checked at the end of
  -- the statement, so deleting a sheet removes both.
  foreign key (lamb_id, sheet_id) references public.kill_lambs (id, sheet_id) on delete no action
);
create index kill_adjustments_sheet on public.kill_adjustments (sheet_id);
create index kill_adjustments_lamb on public.kill_adjustments (lamb_id) where lamb_id is not null;
comment on table public.kill_adjustments is
  'Lamb cost (SPEC 16.4): plus or minus on one lamb (lamb_id) or the whole sheet: dollars, or $ per live lb. Reason premium, dock, hauling or other (other needs a note).';

-- ---------------------------------------------------------------------------
-- Photos of the paper sheet (files in the private kill-sheets bucket).
-- ---------------------------------------------------------------------------
create table public.kill_sheet_photos (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.kill_sheets (id) on delete cascade,
  path text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index kill_sheet_photos_sheet on public.kill_sheet_photos (sheet_id);

-- Triggers: updated_at and the audit log.
create trigger kill_sheets_updated_at before update on public.kill_sheets
  for each row execute function public.set_updated_at();
create trigger kill_sheets_audit after insert or update or delete on public.kill_sheets
  for each row execute function public.audit_row();
create trigger kill_lambs_updated_at before update on public.kill_lambs
  for each row execute function public.set_updated_at();
create trigger kill_lambs_audit after insert or update or delete on public.kill_lambs
  for each row execute function public.audit_row();
create trigger kill_adjustments_updated_at before update on public.kill_adjustments
  for each row execute function public.set_updated_at();
create trigger kill_adjustments_audit after insert or update or delete on public.kill_adjustments
  for each row execute function public.audit_row();
create trigger kill_sheet_photos_updated_at before update on public.kill_sheet_photos
  for each row execute function public.set_updated_at();
create trigger kill_sheet_photos_audit after insert or update or delete on public.kill_sheet_photos
  for each row execute function public.audit_row();

-- Row Level Security: admins only.
alter table public.kill_sheets enable row level security;
alter table public.kill_lambs enable row level security;
alter table public.kill_adjustments enable row level security;
alter table public.kill_sheet_photos enable row level security;

create policy "kill_sheets: admin" on public.kill_sheets for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "kill_lambs: admin" on public.kill_lambs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "kill_adjustments: admin" on public.kill_adjustments for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "kill_sheet_photos: admin" on public.kill_sheet_photos for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.kill_sheets, public.kill_lambs, public.kill_adjustments, public.kill_sheet_photos from anon;
grant select, insert, update, delete on public.kill_sheets, public.kill_lambs, public.kill_adjustments, public.kill_sheet_photos to authenticated;
grant all on public.kill_sheets, public.kill_lambs, public.kill_adjustments, public.kill_sheet_photos to service_role;

-- The functions run as the caller, so the tables' admin-only rules apply.
revoke execute on function public.lamb_cost_rates(uuid, date), public.use_setup_rates(uuid), public.kill_sheets_set_rates() from public, anon;
grant execute on function public.lamb_cost_rates(uuid, date), public.use_setup_rates(uuid) to authenticated, service_role;

-- Live updates.
alter publication supabase_realtime add table
  public.kill_sheets,
  public.kill_lambs,
  public.kill_adjustments,
  public.kill_sheet_photos;

-- Photo bucket: private, admins only. Skipped where Supabase Storage isn't
-- installed (the test database).
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('kill-sheets', 'kill-sheets', false, 10485760, array['image/jpeg', 'image/webp', 'image/png'])
  on conflict (id) do nothing;
  execute $p$
    create policy "kill-sheets: read" on storage.objects for select to authenticated
      using (bucket_id = 'kill-sheets' and (select public.is_admin()))
  $p$;
  execute $p$
    create policy "kill-sheets: add" on storage.objects for insert to authenticated
      with check (bucket_id = 'kill-sheets' and (select public.is_admin()))
  $p$;
  execute $p$
    create policy "kill-sheets: delete" on storage.objects for delete to authenticated
      using (bucket_id = 'kill-sheets' and (select public.is_admin()))
  $p$;
end $$;
