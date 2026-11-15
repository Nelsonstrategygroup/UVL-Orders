-- Lamb cost, stage 1: Setup (SPEC 16, change request 11/14/26).
--
-- A separate module. This migration only ADDS three tables. It changes no
-- existing table, column or row, and nothing existing reads these tables.
-- Admins only (is_admin()), not a permission area, so role_permissions is
-- untouched. Changes are logged by the existing audit trigger.
-- Nothing is seeded: Kathy enters producers and the starting 3.00 / 2.02
-- setting (with the date it applies from) herself.
-- Undo: supabase/rollback/20261114000100_revert.sql

-- Producers who sell lambs to UVL.
create table public.producers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  ranch_name text not null default '',
  contact text not null default '',
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.producers is
  'Lamb cost (SPEC 16): producers UVL buys lambs from. Entered by Kathy; none seeded.';

-- Base rate ($ per lb live) and live weight factor, each from a date on.
-- A week uses the newest setting on or before its kill date.
create table public.lamb_cost_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  base_rate numeric(12, 4) not null check (base_rate >= 0),
  live_factor numeric(8, 4) not null check (live_factor > 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.lamb_cost_settings is
  'Lamb cost (SPEC 16): base $/lb live and live weight factor from effective_from on. Past weeks keep the values stored on their lamb rows.';

-- A producer's own $ per lb live, from a date on, used instead of the base rate.
create table public.producer_rates (
  id uuid primary key default gen_random_uuid(),
  producer_id uuid not null references public.producers (id) on delete cascade,
  effective_from date not null,
  rate numeric(12, 4) not null check (rate >= 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (producer_id, effective_from)
);
comment on table public.producer_rates is
  'Lamb cost (SPEC 16): a producer''s own $/lb live from effective_from on, instead of the base rate.';

-- Updated-at and audit triggers (the audit log records who, when, old value).
create trigger producers_updated_at before update on public.producers
  for each row execute function public.set_updated_at();
create trigger producers_audit after insert or update or delete on public.producers
  for each row execute function public.audit_row();
create trigger lamb_cost_settings_updated_at before update on public.lamb_cost_settings
  for each row execute function public.set_updated_at();
create trigger lamb_cost_settings_audit after insert or update or delete on public.lamb_cost_settings
  for each row execute function public.audit_row();
create trigger producer_rates_updated_at before update on public.producer_rates
  for each row execute function public.set_updated_at();
create trigger producer_rates_audit after insert or update or delete on public.producer_rates
  for each row execute function public.audit_row();

-- Row Level Security: admins only.
alter table public.producers enable row level security;
alter table public.lamb_cost_settings enable row level security;
alter table public.producer_rates enable row level security;

create policy "producers: admin" on public.producers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "lamb_cost_settings: admin" on public.lamb_cost_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "producer_rates: admin" on public.producer_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.producers, public.lamb_cost_settings, public.producer_rates from anon;
grant select, insert, update, delete on public.producers, public.lamb_cost_settings, public.producer_rates to authenticated;
grant all on public.producers, public.lamb_cost_settings, public.producer_rates to service_role;

-- Live updates on the Setup page.
alter publication supabase_realtime add table
  public.producers,
  public.lamb_cost_settings,
  public.producer_rates;
