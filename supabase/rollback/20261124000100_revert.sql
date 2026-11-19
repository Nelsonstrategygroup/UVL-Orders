-- Undoes 20261124000100_producer_pay_from_settings.sql. Sheets keep the numbers they have now.
-- The Nov 1 setting (factor 2) is not put back: it was removed on purpose.

drop trigger if exists lamb_cost_settings_sync on public.lamb_cost_settings;
drop trigger if exists producer_rates_sync on public.producer_rates;
drop function if exists public.sync_kill_sheet_rates();
drop function if exists public.set_sheet_override(uuid, numeric, numeric, text);

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

update public.kill_sheets set rate_source = 'base' where rate_source = 'override';
alter table public.kill_sheets
  drop constraint kill_sheets_override_reason,
  drop constraint kill_sheets_rate_source_check,
  add constraint kill_sheets_rate_source_check check (rate_source in ('base', 'producer')),
  drop column override_reason,
  drop column override_by,
  drop column override_at;
