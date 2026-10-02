-- Cut sheet (4.5). One sheet per week, organized in sets.

create table public.cut_sheets (
  week_id date primary key references public.weeks (id) on delete cascade,
  inv_number text not null default '',
  notes text not null default '',
  pulled_large int check (pulled_large >= 0),
  pulled_medium int check (pulled_medium >= 0),
  pulled_small int check (pulled_small >= 0),
  sent_at timestamptz,
  sent_hash text,
  sent_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.cut_sheet_banners (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.cut_sheets (week_id) on delete cascade,
  text text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index cut_sheet_banners_week_idx on public.cut_sheet_banners (week_id, sort);

-- Ongoing collection goals that print on every sheet until finished.
create table public.saving_goals (
  id uuid primary key default gen_random_uuid(),
  text text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.cut_sets (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.cut_sheets (week_id) on delete cascade,
  name text not null default '',
  lambs int not null default 0 check (lambs >= 0),
  size_class_id text references public.size_classes (id) on delete restrict,
  headline text not null default '',
  sort int not null default 0,
  filled_week date,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index cut_sets_week_idx on public.cut_sets (week_id, sort);

create table public.cut_set_lines (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.cut_sets (id) on delete cascade,
  kind text not null default 'line' check (kind in ('line', 'note')),
  cut_spec_id text references public.cut_specs (id) on delete restrict,
  qty numeric check (qty >= 0),
  text text,
  side_note text not null default '',
  highlight text check (highlight in ('yellow', 'blue', 'green')),
  shank_on boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (kind = 'note' or cut_spec_id is not null)
);

create index cut_set_lines_set_idx on public.cut_set_lines (set_id, sort);

create table public.cut_set_customers (
  set_id uuid not null references public.cut_sets (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (set_id, customer_id)
);

-- Triggers
create trigger cut_sheets_updated_at before update on public.cut_sheets
  for each row execute function public.set_updated_at();
create trigger cut_sheets_audit after insert or update or delete on public.cut_sheets
  for each row execute function public.audit_row('week_id');

create trigger cut_sheet_banners_updated_at before update on public.cut_sheet_banners
  for each row execute function public.set_updated_at();
create trigger cut_sheet_banners_audit after insert or update or delete on public.cut_sheet_banners
  for each row execute function public.audit_row();

create trigger saving_goals_updated_at before update on public.saving_goals
  for each row execute function public.set_updated_at();
create trigger saving_goals_audit after insert or update or delete on public.saving_goals
  for each row execute function public.audit_row();

create trigger cut_sets_updated_at before update on public.cut_sets
  for each row execute function public.set_updated_at();
create trigger cut_sets_audit after insert or update or delete on public.cut_sets
  for each row execute function public.audit_row();

create trigger cut_set_lines_updated_at before update on public.cut_set_lines
  for each row execute function public.set_updated_at();
create trigger cut_set_lines_audit after insert or update or delete on public.cut_set_lines
  for each row execute function public.audit_row();

create trigger cut_set_customers_updated_at before update on public.cut_set_customers
  for each row execute function public.set_updated_at();
create trigger cut_set_customers_audit after insert or update or delete on public.cut_set_customers
  for each row execute function public.audit_row('set_id', 'customer_id');

-- RLS: office and admin only. Packing has no access.
alter table public.cut_sheets enable row level security;
alter table public.cut_sheet_banners enable row level security;
alter table public.saving_goals enable row level security;
alter table public.cut_sets enable row level security;
alter table public.cut_set_lines enable row level security;
alter table public.cut_set_customers enable row level security;

create policy "cut_sheets: staff all" on public.cut_sheets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "cut_sheet_banners: staff all" on public.cut_sheet_banners
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "saving_goals: staff all" on public.saving_goals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "cut_sets: staff all" on public.cut_sets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "cut_set_lines: staff all" on public.cut_set_lines
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "cut_set_customers: staff all" on public.cut_set_customers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Grants
revoke all on public.cut_sheets, public.cut_sheet_banners, public.saving_goals, public.cut_sets, public.cut_set_lines, public.cut_set_customers from anon;
grant select, insert, update, delete on public.cut_sheets, public.cut_sheet_banners, public.saving_goals, public.cut_sets, public.cut_set_lines, public.cut_set_customers to authenticated;
