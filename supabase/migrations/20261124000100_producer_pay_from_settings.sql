-- Producer pay follows the dated settings (Lucas, 11/18/26).
--
-- Until now a kill sheet kept the rate and live factor it was created with, so
-- a later setting never reached it. Now the setting (or the producer's own
-- rate) that covers the kill date decides. The sheet still holds the numbers:
-- saving a setting or producer rate updates every sheet in an open week, in the
-- same step, and a closed week's sheets stay as they were (that's what keeps
-- them frozen).
--
-- A sheet can have its own rate and factor for a special case: an override,
-- with a required reason, shown as one.
--
-- The rate and factor on a sheet can only change through these paths.
--
-- Also removes the $3.00 / factor 2 setting from Nov 1, entered 11/17 only to
-- show the difference (Lucas, 11/18/26: "2.00 should not stand"). The kills of
-- Nov 6 and Nov 13 stay at 2.02.
--
-- Undo: supabase/rollback/20261124000100_revert.sql

delete from public.lamb_cost_settings
where effective_from = '2026-11-01' and base_rate = 3 and live_factor = 2;

alter table public.kill_sheets
  add column override_reason text,
  add column override_by uuid,
  add column override_at timestamptz,
  drop constraint kill_sheets_rate_source_check,
  add constraint kill_sheets_rate_source_check check (rate_source in ('base', 'producer', 'override')),
  add constraint kill_sheets_override_reason check (rate_source <> 'override' or btrim(coalesce(override_reason, '')) <> '');
comment on column public.kill_sheets.base_rate is 'The rate this kill is paid at: from the setting covering the kill date, kept up to date while the week is open; or its override.';
comment on column public.kill_sheets.live_factor is 'The live weight factor, the same way as base_rate.';
comment on column public.kill_sheets.override_reason is 'Why this kill has its own rate and factor (rate_source = override).';
comment on column public.kill_sheets.override_by is 'Who set the override (a profiles id; no foreign key on purpose).';
comment on table public.kill_sheets is
  'Lamb cost (SPEC 16.3): one of Mohawk''s kill log sheets, one producer and kill date. base_rate and live_factor follow the dated settings while the week is open, unless overridden; a closed week keeps its numbers.';

create or replace function public.kill_sheets_set_rates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r record;
begin
  if tg_op = 'INSERT' or new.producer_id is distinct from old.producer_id or new.kill_date is distinct from old.kill_date then
    if tg_op = 'UPDATE' and old.rate_source = 'override' then
      new.base_rate := old.base_rate;
      new.live_factor := old.live_factor;
      new.rate_source := old.rate_source;
      new.override_reason := old.override_reason;
      new.override_by := old.override_by;
      new.override_at := old.override_at;
      return new;
    end if;
    select * into r from public.lamb_cost_rates(new.producer_id, new.kill_date);
    new.base_rate := r.base_rate;
    new.live_factor := r.live_factor;
    new.rate_source := r.rate_source;
    new.override_reason := null;
    new.override_by := null;
    new.override_at := null;
  elsif coalesce(current_setting('uvl.rate_sync', true), '') <> 'on' then
    -- Only the setting sync and the override functions change these.
    new.base_rate := old.base_rate;
    new.live_factor := old.live_factor;
    new.rate_source := old.rate_source;
    new.override_reason := old.override_reason;
    new.override_by := old.override_by;
    new.override_at := old.override_at;
  end if;
  return new;
end $$;

-- After a setting or producer rate changes: every kill in an open week, unless overridden.
create or replace function public.sync_kill_sheet_rates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare s record; r record;
begin
  perform set_config('uvl.rate_sync', 'on', true);
  perform set_config('uvl.source', 'rate or factor changed (P&L Setup)', true);
  for s in
    select id, producer_id, kill_date, base_rate, live_factor, rate_source
    from public.kill_sheets
    where rate_source <> 'override' and not public.week_is_closed(week_id)
  loop
    select * into r from public.lamb_cost_rates(s.producer_id, s.kill_date);
    if r.base_rate <> s.base_rate or r.live_factor <> s.live_factor or r.rate_source <> s.rate_source then
      update public.kill_sheets
      set base_rate = r.base_rate, live_factor = r.live_factor, rate_source = r.rate_source
      where id = s.id;
    end if;
  end loop;
  perform set_config('uvl.rate_sync', 'off', true);
  return null;
end $$;
revoke execute on function public.sync_kill_sheet_rates() from public, anon, authenticated;

create trigger lamb_cost_settings_sync after insert or update or delete on public.lamb_cost_settings
  for each statement execute function public.sync_kill_sheet_rates();
create trigger producer_rates_sync after insert or update or delete on public.producer_rates
  for each statement execute function public.sync_kill_sheet_rates();

-- Back to the setting for the kill date (also ends an override).
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
  perform set_config('uvl.source', 'use the setting (carcass weights)', true);
  perform set_config('uvl.rate_sync', 'on', true);
  update public.kill_sheets
  set base_rate = r.base_rate, live_factor = r.live_factor, rate_source = r.rate_source,
      override_reason = null, override_by = null, override_at = null
  where id = p_sheet;
  perform set_config('uvl.rate_sync', 'off', true);
end $$;

-- This kill's own rate and factor, with the reason. Runs as the caller, so
-- the table's rules (Carcass weights, Change) and the closed-week guard apply.
create or replace function public.set_sheet_override(p_sheet uuid, p_rate numeric, p_factor numeric, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.can_change('carcass') then
    raise exception 'You don''t have permission to change carcass weights.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Type why this kill is different.' using errcode = '22023';
  end if;
  perform set_config('uvl.source', 'override: ' || v_reason, true);
  perform set_config('uvl.rate_sync', 'on', true);
  update public.kill_sheets
  set base_rate = p_rate, live_factor = p_factor, rate_source = 'override',
      override_reason = v_reason, override_by = auth.uid(), override_at = now()
  where id = p_sheet;
  perform set_config('uvl.rate_sync', 'off', true);
  if not found then
    raise exception 'That sheet is gone.';
  end if;
end $$;
revoke execute on function public.set_sheet_override(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.set_sheet_override(uuid, numeric, numeric, text) to authenticated, service_role;
