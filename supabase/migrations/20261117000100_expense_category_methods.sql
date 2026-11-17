-- One list of expense categories (Lucas, 11/16/26), stage A. The P&L's
-- "Charges" (ALB/OSC, Marketing) were expenses kept apart; now every expense
-- is a category with a group (Cost of product, Delivery, Operating), a
-- calculation method, and rates with start dates, all editable in P&L Setup:
--
--   entered           amounts typed in by date (expense entries, as before)
--   per_lamb          lambs on the weigh sheets × rate (ALB/OSC)
--   percent_income    percent of all income, or of sales only (Marketing)
--   weigh_sheets      producer pay (the existing weigh sheet calculation)
--   fixed_weekly      a weekly amount from parts (weekly + yearly ÷ 52),
--                     every week, no-processing weeks too
--   percent_category  percent of other categories (payroll taxes)
--   per_truck_run, freight_weight, freight_pallet: come with the truck run
--                     log and freight from pallets (later stages)
--
-- Copies every per-lamb and percent charge (with its dates) into categories
-- and rates. pnl_lamb_charges and pnl_percent_charges stay until the app
-- no longer reads them (20261117000200 removes them, after deploying). Renames
-- the four starting categories to the new list. No expense entries exist;
-- any would keep their category (only the names change).
--
-- Undo: supabase/rollback/20261117000100_revert.sql

alter table public.expense_categories
  add column group_name text not null default 'Operating'
    check (group_name in ('Cost of product', 'Delivery', 'Operating')),
  add column method text not null default 'entered'
    check (method in ('entered', 'per_lamb', 'percent_income', 'weigh_sheets', 'fixed_weekly', 'percent_category',
                      'per_truck_run', 'freight_weight', 'freight_pallet')),
  add column income_base text not null default 'all' check (income_base in ('all', 'sales')),
  add column base_category_ids uuid[] not null default '{}',
  add column note text not null default '';
comment on column public.expense_categories.method is
  'How the category''s weekly amount is worked out: entered, per_lamb, percent_income, weigh_sheets, fixed_weekly, percent_category (later: per_truck_run, freight_weight, freight_pallet). Expense entries add to any category.';
comment on column public.expense_categories.income_base is 'percent_income: all (all income) or sales (invoices only).';
comment on column public.expense_categories.base_category_ids is 'percent_category: the categories it''s a percent of.';
-- Producer pay comes from the weigh sheets once.
create unique index expense_categories_one_weigh_sheets on public.expense_categories ((method)) where method = 'weigh_sheets';

create table public.expense_category_rates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories (id) on delete cascade,
  effective_from date not null,
  -- $ per lamb, per truck run, per pallet or per lb.
  amount numeric(12, 4) check (amount is null or amount >= 0),
  percent numeric(8, 4) check (percent is null or (percent >= 0 and percent <= 100)),
  -- fixed_weekly: [{"label": "...", "amount": 60, "per": "week" | "year"}]
  parts jsonb not null default '[]' check (jsonb_typeof(parts) = 'array'),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (category_id, effective_from)
);
create index expense_category_rates_category on public.expense_category_rates (category_id);
comment on table public.expense_category_rates is
  'A category''s rate from a date on: amount (per lamb, run, pallet, lb), percent, or parts (fixed weekly). The newest on or before the week applies.';

create trigger expense_category_rates_updated_at before update on public.expense_category_rates
  for each row execute function public.set_updated_at();
create trigger expense_category_rates_audit after insert or update or delete on public.expense_category_rates
  for each row execute function public.audit_row();
alter table public.expense_category_rates enable row level security;
create policy "expense_category_rates: admin" on public.expense_category_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.expense_category_rates from anon;
grant select, insert, update, delete on public.expense_category_rates to authenticated;
grant all on public.expense_category_rates to service_role;
alter publication supabase_realtime add table public.expense_category_rates;

-- ---------------------------------------------------------------------------
-- The starting list (Lucas, 11/16/26). Rates from Oct 8, 2026 unless they
-- came from a charge (those keep their own dates).
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  r record;
begin
  perform set_config('uvl.source', 'expense category list (Lucas 11/16/26)', true);

  -- The four starting categories, renamed into the new list.
  update public.expense_categories set name = 'Processing, Mohawk', group_name = 'Cost of product', sort = 20 where name = 'Butcher (Mohawk)';
  update public.expense_categories set name = 'Labor, other', group_name = 'Operating', sort = 320 where name = 'Labor';
  update public.expense_categories set name = 'Freight, other carriers', group_name = 'Delivery', sort = 200 where name = 'Freight';
  update public.expense_categories set group_name = 'Operating', sort = 340 where name = 'Other';

  insert into public.expense_categories (name, group_name, method, sort) values
    ('Producer pay', 'Cost of product', 'weigh_sheets', 10),
    ('Processing, Mohawk', 'Cost of product', 'entered', 20),
    ('Truck, insurance', 'Delivery', 'fixed_weekly', 140),
    ('Truck, depreciation', 'Delivery', 'fixed_weekly', 150),
    ('Truck, repairs', 'Delivery', 'entered', 160),
    ('Freight, other carriers', 'Delivery', 'entered', 200),
    ('Labor, other', 'Operating', 'entered', 320),
    ('Supplies', 'Operating', 'entered', 330),
    ('Other', 'Operating', 'entered', 340)
  on conflict (name) do nothing;

  insert into public.expense_category_rates (category_id, effective_from, parts, note)
  select id, '2026-10-08', '[{"label": "Weekly amount", "amount": 60, "per": "week"},
                            {"label": "Weekly amount", "amount": 15.69, "per": "week"},
                            {"label": "Yearly amount", "amount": 1698, "per": "year"},
                            {"label": "Yearly amount", "amount": 110, "per": "year"}]'::jsonb,
         'Both trucks (Lucas, 11/16/26)'
  from public.expense_categories where name = 'Truck, insurance'
  on conflict (category_id, effective_from) do nothing;
  insert into public.expense_category_rates (category_id, effective_from, parts, note)
  select id, '2026-10-08', '[{"label": "Weekly amount", "amount": 150, "per": "week"}]'::jsonb, 'Lucas, 11/16/26'
  from public.expense_categories where name = 'Truck, depreciation'
  on conflict (category_id, effective_from) do nothing;

  -- Charges into categories, every rate with its own date.
  for r in select distinct name from public.pnl_lamb_charges loop
    insert into public.expense_categories (name, group_name, method, sort)
    values (case when r.name = 'ALB/OSC' then 'ALB/OSC assessments' else r.name end, 'Operating', 'per_lamb', 310)
    on conflict (name) do update set method = 'per_lamb'
    returning id into v_id;
    insert into public.expense_category_rates (category_id, effective_from, amount, note)
    select v_id, effective_from, per_lamb, note from public.pnl_lamb_charges where name = r.name
    on conflict (category_id, effective_from) do nothing;
  end loop;
  for r in select distinct name from public.pnl_percent_charges loop
    insert into public.expense_categories (name, group_name, method, income_base, sort)
    values (r.name, 'Operating', 'percent_income', 'all', 300)
    on conflict (name) do update set method = 'percent_income'
    returning id into v_id;
    insert into public.expense_category_rates (category_id, effective_from, percent, note)
    select v_id, effective_from, percent, note from public.pnl_percent_charges where name = r.name
    on conflict (category_id, effective_from) do nothing;
  end loop;
end $$;
