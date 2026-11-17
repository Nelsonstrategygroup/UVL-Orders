-- Undo 20261117000100_expense_category_methods.sql: puts the per-lamb and
-- percent charges back in their own tables (from the per_lamb and
-- percent_income categories' rates), removes the categories added by the
-- migration that have no expense entries, names the four starting
-- categories as before, and removes the rates table and the new columns.
-- Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261117000100_revert.sql

begin;

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
insert into public.pnl_lamb_charges (name, effective_from, per_lamb, note)
select case when c.name = 'ALB/OSC assessments' then 'ALB/OSC' else c.name end, r.effective_from, coalesce(r.amount, 0), r.note
from public.expense_category_rates r join public.expense_categories c on c.id = r.category_id where c.method = 'per_lamb';
insert into public.pnl_percent_charges (name, effective_from, percent, note)
select c.name, r.effective_from, coalesce(r.percent, 0), r.note
from public.expense_category_rates r join public.expense_categories c on c.id = r.category_id where c.method = 'percent_income';

create trigger pnl_lamb_charges_updated_at before update on public.pnl_lamb_charges for each row execute function public.set_updated_at();
create trigger pnl_lamb_charges_audit after insert or update or delete on public.pnl_lamb_charges for each row execute function public.audit_row();
create trigger pnl_percent_charges_updated_at before update on public.pnl_percent_charges for each row execute function public.set_updated_at();
create trigger pnl_percent_charges_audit after insert or update or delete on public.pnl_percent_charges for each row execute function public.audit_row();
alter table public.pnl_lamb_charges enable row level security;
alter table public.pnl_percent_charges enable row level security;
create policy "pnl_lamb_charges: admin" on public.pnl_lamb_charges for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "pnl_percent_charges: admin" on public.pnl_percent_charges for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.pnl_lamb_charges, public.pnl_percent_charges from anon;
grant select, insert, update, delete on public.pnl_lamb_charges, public.pnl_percent_charges to authenticated;
grant all on public.pnl_lamb_charges, public.pnl_percent_charges to service_role;
alter publication supabase_realtime add table public.pnl_lamb_charges, public.pnl_percent_charges;

drop table public.expense_category_rates;
delete from public.expense_categories c
where (c.method <> 'entered' or c.name in ('Producer pay', 'Truck, repairs', 'Supplies'))
  and not exists (select 1 from public.pnl_expenses e where e.category_id = c.id);
update public.expense_categories set name = 'Butcher (Mohawk)', sort = 1 where name = 'Processing, Mohawk';
update public.expense_categories set name = 'Labor', sort = 2 where name = 'Labor, other';
update public.expense_categories set name = 'Freight', sort = 3 where name = 'Freight, other carriers';
update public.expense_categories set sort = 4 where name = 'Other';
drop index if exists public.expense_categories_one_weigh_sheets;
alter table public.expense_categories
  drop column group_name, drop column method, drop column income_base, drop column base_category_ids, drop column note;
delete from supabase_migrations.schema_migrations where version = '20261117000100';
commit;
