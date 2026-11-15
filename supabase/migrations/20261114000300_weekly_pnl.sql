-- Lamb cost, stage 3: weekly P&L (SPEC 16.6, Lucas 11/14/26).
--
-- Only ADDS: five tables, one function, and starting rows (ALB/OSC $1.80 per
-- lamb, Marketing 4% of income, four expense categories). Changes no existing
-- table, column or row, and nothing existing reads these tables. Admins only
-- (is_admin()). Every change is in the audit log.
--
-- Income entries copy the customer's id and name but have NO foreign key to
-- customers, so deleting or changing a customer works exactly as before and
-- no new link appears in the API.
--
-- Undo: supabase/rollback/20261114000300_revert.sql

-- The packing Monday of the Thursday-Wednesday order week containing a date
-- (packingMonday() in lib/dates.ts). Same rule as kill_sheets.week_id.
create or replace function public.order_week(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  select d - ((extract(dow from d)::int - 4 + 7) % 7) + 4
$$;

-- ---------------------------------------------------------------------------
-- Charges worked out from the week, each from a date on. The newest row on or
-- before the week's packing Monday applies; 0 from a date stops one.
-- ---------------------------------------------------------------------------
create table public.pnl_lamb_charges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  effective_from date not null,
  per_lamb numeric(12, 4) not null check (per_lamb >= 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (name, effective_from)
);
comment on table public.pnl_lamb_charges is
  'P&L (SPEC 16.6): a charge per lamb (ALB/OSC), times the week''s lambs on the weigh sheets. From effective_from on; 0 stops it.';

create table public.pnl_percent_charges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  effective_from date not null,
  percent numeric(7, 4) not null check (percent >= 0 and percent <= 100),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (name, effective_from)
);
comment on table public.pnl_percent_charges is
  'P&L (SPEC 16.6): a percent of the week''s income (Marketing). From effective_from on; 0 stops it.';

-- ---------------------------------------------------------------------------
-- Expense categories and entries
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  active boolean not null default true,
  sort int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.pnl_expenses (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  week_id date generated always as (public.order_week(entry_date)) stored,
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  amount numeric(12, 2) not null check (amount <> 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index pnl_expenses_week on public.pnl_expenses (week_id);
create index pnl_expenses_category on public.pnl_expenses (category_id);
comment on table public.pnl_expenses is
  'P&L (SPEC 16.6): an expense on a date (Butcher, Labor, Freight, ...). Counts toward the order week containing the date.';

-- ---------------------------------------------------------------------------
-- Income entries (a stopgap until invoices are used)
-- ---------------------------------------------------------------------------
create table public.pnl_income (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  week_id date generated always as (public.order_week(entry_date)) stored,
  customer_id uuid, -- no foreign key on purpose (see the top of this file)
  customer_name text not null check (btrim(customer_name) <> ''),
  amount numeric(12, 2) not null check (amount <> 0),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index pnl_income_week on public.pnl_income (week_id);
comment on table public.pnl_income is
  'P&L (SPEC 16.6): income from a customer on a date. customer_id and customer_name are copied from the customer list; no foreign key, so customers are untouched.';

-- Starting rows (Lucas, 11/14/26), from Oct 1, 2026 like the starting rate.
insert into public.pnl_lamb_charges (name, effective_from, per_lamb, note)
values ('ALB/OSC', '2026-10-01', 1.80, 'Starting charge (Lucas, 11/14/26)')
on conflict (name, effective_from) do nothing;
insert into public.pnl_percent_charges (name, effective_from, percent, note)
values ('Marketing', '2026-10-01', 4, 'Starting charge (Lucas, 11/14/26)')
on conflict (name, effective_from) do nothing;
insert into public.expense_categories (name, sort) values
  ('Butcher (Mohawk)', 1), ('Labor', 2), ('Freight', 3), ('Other', 4)
on conflict (name) do nothing;

-- Triggers: updated_at and the audit log.
create trigger pnl_lamb_charges_updated_at before update on public.pnl_lamb_charges
  for each row execute function public.set_updated_at();
create trigger pnl_lamb_charges_audit after insert or update or delete on public.pnl_lamb_charges
  for each row execute function public.audit_row();
create trigger pnl_percent_charges_updated_at before update on public.pnl_percent_charges
  for each row execute function public.set_updated_at();
create trigger pnl_percent_charges_audit after insert or update or delete on public.pnl_percent_charges
  for each row execute function public.audit_row();
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();
create trigger expense_categories_audit after insert or update or delete on public.expense_categories
  for each row execute function public.audit_row();
create trigger pnl_expenses_updated_at before update on public.pnl_expenses
  for each row execute function public.set_updated_at();
create trigger pnl_expenses_audit after insert or update or delete on public.pnl_expenses
  for each row execute function public.audit_row();
create trigger pnl_income_updated_at before update on public.pnl_income
  for each row execute function public.set_updated_at();
create trigger pnl_income_audit after insert or update or delete on public.pnl_income
  for each row execute function public.audit_row();

-- Row Level Security: admins only.
alter table public.pnl_lamb_charges enable row level security;
alter table public.pnl_percent_charges enable row level security;
alter table public.expense_categories enable row level security;
alter table public.pnl_expenses enable row level security;
alter table public.pnl_income enable row level security;

create policy "pnl_lamb_charges: admin" on public.pnl_lamb_charges for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pnl_percent_charges: admin" on public.pnl_percent_charges for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "expense_categories: admin" on public.expense_categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pnl_expenses: admin" on public.pnl_expenses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pnl_income: admin" on public.pnl_income for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.pnl_lamb_charges, public.pnl_percent_charges, public.expense_categories,
  public.pnl_expenses, public.pnl_income from anon;
grant select, insert, update, delete on public.pnl_lamb_charges, public.pnl_percent_charges,
  public.expense_categories, public.pnl_expenses, public.pnl_income to authenticated;
grant all on public.pnl_lamb_charges, public.pnl_percent_charges, public.expense_categories,
  public.pnl_expenses, public.pnl_income to service_role;
grant execute on function public.order_week(date) to authenticated, service_role;

-- Live updates.
alter publication supabase_realtime add table
  public.pnl_lamb_charges,
  public.pnl_percent_charges,
  public.expense_categories,
  public.pnl_expenses,
  public.pnl_income;
