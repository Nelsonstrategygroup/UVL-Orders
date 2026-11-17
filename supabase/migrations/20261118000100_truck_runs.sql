-- Truck run log (Lucas, 11/16/26), stage B of one list of expense
-- categories. Each delivery run: date, driver, stops (customer locations,
-- distributors, or typed), extra and skipped stops, fuel, a note and an
-- optional receipt. Driver pay per run, from the driver's rates in P&L Setup:
-- base + per extra stop − per skipped stop. Truck maintenance per run, for
-- drivers who have it turned on (off unless turned on; Lucas: it likely
-- won't continue). Payroll taxes are a percent of driver pay only. Each run
-- counts toward the order week containing its date.
--
-- Who: a new screen area, "trucks". Office and Billing change it, Viewer
-- looks, Packing doesn't see it; admins can do anything. Drivers' rates are
-- changed by admins only (P&L Setup).
--
-- Adds: the trucks area; tables truck_drivers, truck_driver_rates,
-- truck_runs, truck_run_stops; a private truck-files bucket; two columns on
-- expense_categories (truck_part, delivery_kind) and five truck
-- categories; closed-week guards on runs and stops. No existing row changes
-- except setting delivery_kind on the Delivery categories.
--
-- Undo: supabase/rollback/20261118000100_revert.sql

-- ---------------------------------------------------------------------------
-- The trucks area
-- ---------------------------------------------------------------------------
create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup', 'invoices', 'prices', 'trucks'];
$$;
insert into public.role_permissions (role, area, level) values
  ('office', 'trucks', 2), ('billing', 'trucks', 2), ('viewer', 'trucks', 1), ('packing', 'trucks', 0)
on conflict (role, area) do nothing;

-- ---------------------------------------------------------------------------
-- Drivers and their pay rates
-- ---------------------------------------------------------------------------
create table public.truck_drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  active boolean not null default true,
  -- Truck maintenance is charged on this driver's runs.
  maintenance boolean not null default false,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.truck_drivers is 'Who drives delivery runs. maintenance: the Truck, maintenance category is charged on their runs.';

create table public.truck_driver_rates (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.truck_drivers (id) on delete cascade,
  effective_from date not null,
  base numeric(12, 2) not null check (base >= 0),
  per_extra numeric(12, 2) not null default 0 check (per_extra >= 0),
  per_skipped numeric(12, 2) not null default 0 check (per_skipped >= 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (driver_id, effective_from)
);
comment on table public.truck_driver_rates is 'A driver''s pay per run from a date on: base + per_extra × extra stops − per_skipped × skipped stops.';

-- ---------------------------------------------------------------------------
-- Runs and their stops
-- ---------------------------------------------------------------------------
create table public.truck_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  week_id date generated always as (public.order_week(run_date)) stored,
  driver_id uuid not null references public.truck_drivers (id) on delete restrict,
  fuel numeric(12, 2) check (fuel is null or fuel >= 0),
  note text not null default '',
  receipt_path text,
  receipt_name text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index truck_runs_week on public.truck_runs (week_id);
comment on table public.truck_runs is 'A delivery run. Counts toward the order week containing run_date. fuel: what the fuel cost (blank: not entered yet).';

create table public.truck_run_stops (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.truck_runs (id) on delete cascade,
  -- stop: a regular stop (in the base pay); extra: added; skipped: on the route but not made.
  kind text not null default 'stop' check (kind in ('stop', 'extra', 'skipped')),
  customer_id uuid references public.customers (id) on delete set null,
  point_id uuid references public.consolidation_points (id) on delete set null,
  -- The stop's name as picked (kept if the customer is later deleted), or typed.
  name text not null check (btrim(name) <> ''),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index truck_run_stops_run on public.truck_run_stops (run_id);
comment on table public.truck_run_stops is 'A stop on a run: a customer location, a distributor, or a name typed in.';

-- ---------------------------------------------------------------------------
-- Triggers, Row Level Security, realtime
-- ---------------------------------------------------------------------------
create trigger truck_drivers_updated_at before update on public.truck_drivers for each row execute function public.set_updated_at();
create trigger truck_drivers_audit after insert or update or delete on public.truck_drivers for each row execute function public.audit_row();
create trigger truck_driver_rates_updated_at before update on public.truck_driver_rates for each row execute function public.set_updated_at();
create trigger truck_driver_rates_audit after insert or update or delete on public.truck_driver_rates for each row execute function public.audit_row();
create trigger truck_runs_updated_at before update on public.truck_runs for each row execute function public.set_updated_at();
create trigger truck_runs_audit after insert or update or delete on public.truck_runs for each row execute function public.audit_row();
create trigger truck_run_stops_updated_at before update on public.truck_run_stops for each row execute function public.set_updated_at();
create trigger truck_run_stops_audit after insert or update or delete on public.truck_run_stops for each row execute function public.audit_row();

alter table public.truck_drivers enable row level security;
alter table public.truck_driver_rates enable row level security;
alter table public.truck_runs enable row level security;
alter table public.truck_run_stops enable row level security;
create policy "truck_drivers: read" on public.truck_drivers for select to authenticated
  using ((select public.can_view('trucks')));
create policy "truck_drivers: admin" on public.truck_drivers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "truck_driver_rates: read" on public.truck_driver_rates for select to authenticated
  using ((select public.can_view('trucks')));
create policy "truck_driver_rates: admin" on public.truck_driver_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "truck_runs: read" on public.truck_runs for select to authenticated
  using ((select public.can_view('trucks')));
create policy "truck_runs: change" on public.truck_runs for all to authenticated
  using ((select public.can_change('trucks'))) with check ((select public.can_change('trucks')));
create policy "truck_run_stops: read" on public.truck_run_stops for select to authenticated
  using ((select public.can_view('trucks')));
create policy "truck_run_stops: change" on public.truck_run_stops for all to authenticated
  using ((select public.can_change('trucks'))) with check ((select public.can_change('trucks')));
revoke all on public.truck_drivers, public.truck_driver_rates, public.truck_runs, public.truck_run_stops from anon;
grant select, insert, update, delete on public.truck_drivers, public.truck_driver_rates, public.truck_runs, public.truck_run_stops to authenticated;
grant all on public.truck_drivers, public.truck_driver_rates, public.truck_runs, public.truck_run_stops to service_role;
alter publication supabase_realtime add table public.truck_drivers, public.truck_driver_rates, public.truck_runs, public.truck_run_stops;

-- Fuel receipts: private, for whoever can see truck runs; photos and PDFs up to 10 MB.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('truck-files', 'truck-files', false, 10485760, array['image/jpeg', 'image/webp', 'image/png', 'application/pdf'])
  on conflict (id) do nothing;
  execute $p$
    create policy "truck-files: read" on storage.objects for select to authenticated
      using (bucket_id = 'truck-files' and (select public.can_view('trucks')))
  $p$;
  execute $p$
    create policy "truck-files: add" on storage.objects for insert to authenticated
      with check (bucket_id = 'truck-files' and (select public.can_change('trucks')))
  $p$;
  execute $p$
    create policy "truck-files: delete" on storage.objects for delete to authenticated
      using (bucket_id = 'truck-files' and (select public.can_change('trucks')))
  $p$;
end $$;

-- ---------------------------------------------------------------------------
-- The truck categories
-- ---------------------------------------------------------------------------
alter table public.expense_categories
  add column truck_part text check (truck_part is null or truck_part in ('driver_pay', 'fuel', 'maintenance')),
  add column delivery_kind text check (delivery_kind is null or delivery_kind in ('truck', 'freight'));
comment on column public.expense_categories.truck_part is 'per_truck_run: which part of a run it counts (driver_pay, fuel, maintenance).';
comment on column public.expense_categories.delivery_kind is 'Delivery categories: truck (UVL''s own truck: counts toward cost per stop) or freight (carriers).';

do $$
declare
  v_pay uuid;
begin
  perform set_config('uvl.source', 'truck run log (Lucas 11/16/26)', true);
  update public.expense_categories set delivery_kind = 'truck' where name in ('Truck, insurance', 'Truck, depreciation', 'Truck, repairs');
  update public.expense_categories set delivery_kind = 'freight' where name = 'Freight, other carriers';

  insert into public.expense_categories (name, group_name, method, truck_part, delivery_kind, sort) values
    ('Truck, driver pay', 'Delivery', 'per_truck_run', 'driver_pay', 'truck', 100),
    ('Truck, fuel', 'Delivery', 'per_truck_run', 'fuel', 'truck', 120),
    ('Truck, maintenance', 'Delivery', 'per_truck_run', 'maintenance', 'truck', 130)
  on conflict (name) do nothing;
  select id into v_pay from public.expense_categories where name = 'Truck, driver pay';
  insert into public.expense_categories (name, group_name, method, base_category_ids, delivery_kind, sort) values
    ('Truck, payroll taxes: SAIF', 'Delivery', 'percent_category', array[v_pay], 'truck', 110),
    ('Truck, payroll taxes: FICA', 'Delivery', 'percent_category', array[v_pay], 'truck', 115)
  on conflict (name) do nothing;

  insert into public.expense_category_rates (category_id, effective_from, percent, note)
  select id, '2026-10-08', 10, 'Of driver pay (Lucas, 11/16/26)' from public.expense_categories where name = 'Truck, payroll taxes: SAIF'
  on conflict (category_id, effective_from) do nothing;
  insert into public.expense_category_rates (category_id, effective_from, percent, note)
  select id, '2026-10-08', 8, 'Of driver pay (Lucas, 11/16/26)' from public.expense_categories where name = 'Truck, payroll taxes: FICA'
  on conflict (category_id, effective_from) do nothing;
  insert into public.expense_category_rates (category_id, effective_from, amount, note)
  select id, '2026-10-08', 50, 'Per run, for drivers with maintenance on (Lucas, 11/16/26)' from public.expense_categories where name = 'Truck, maintenance'
  on conflict (category_id, effective_from) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Closed weeks: runs and their stops can't change either.
-- (As in 20261116000100_pnl_close_weeks.sql, plus truck_run_stops.)
-- ---------------------------------------------------------------------------
create or replace function public.closed_week_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_week date;
  v_sent constant text[] := array['status', 'sent_at', 'sent_by', 'updated_at'];
begin
  if tg_table_name = 'invoices' and tg_op = 'UPDATE' then
    if old.week_id = new.week_id
      and old.status in ('finalized', 'sent') and new.status in ('finalized', 'sent')
      and (to_jsonb(new) - v_sent) = (to_jsonb(old) - v_sent) then
      return null;
    end if;
  end if;

  foreach v_row in array array[
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  ] loop
    continue when v_row is null;
    v_week := case tg_table_name
      when 'order_lines' then (select o.week_id from public.orders o where o.id = (v_row ->> 'order_id')::uuid)
      when 'packing_weights' then (select o.week_id from public.orders o where o.id = (v_row ->> 'order_id')::uuid)
      when 'packing_lines' then (select o.week_id from public.orders o where o.id = (v_row ->> 'order_id')::uuid)
      when 'invoice_lines' then (select i.week_id from public.invoices i where i.id = (v_row ->> 'invoice_id')::uuid)
      when 'kill_lambs' then (select s.week_id from public.kill_sheets s where s.id = (v_row ->> 'sheet_id')::uuid)
      when 'truck_run_stops' then (select r.week_id from public.truck_runs r where r.id = (v_row ->> 'run_id')::uuid)
      when 'kill_adjustments' then (select s.week_id from public.kill_sheets s where s.id = (v_row ->> 'sheet_id')::uuid)
      else (v_row ->> 'week_id')::date
    end;
    if v_week is not null and public.week_is_closed(v_week) then
      raise exception 'The week of % is closed on the Weekly P&L. Reopen it there to make changes.',
        to_char(v_week, 'FMMon FMDD, YYYY') using errcode = '55000';
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.closed_week_guard() from public, anon, authenticated;

create trigger truck_runs_closed_week after insert or update or delete on public.truck_runs
  for each row execute function public.closed_week_guard();
create trigger truck_run_stops_closed_week after insert or update or delete on public.truck_run_stops
  for each row execute function public.closed_week_guard();
