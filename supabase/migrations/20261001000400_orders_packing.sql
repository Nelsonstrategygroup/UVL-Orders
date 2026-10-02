-- Weekly orders and packing (4.4).

create table public.weeks (
  id date primary key check (extract(isodow from id) = 1), -- the Monday
  process_date date,
  producer text not null default '',
  lamb_override int check (lamb_override >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'todo' check (status in ('todo', 'ordered', 'none', 'callback')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (week_id, customer_id)
);

create index orders_customer_idx on public.orders (customer_id);

-- A line is deleted when its qty becomes 0.
create table public.order_lines (
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id) on delete restrict,
  qty numeric not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (order_id, product_id)
);

create table public.packing_lines (
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id) on delete restrict,
  packed_qty numeric not null check (packed_qty >= 0),
  packed_by uuid default auth.uid() references public.profiles (id),
  packed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (order_id, product_id)
);

create table public.packing_orders (
  order_id uuid primary key references public.orders (id) on delete cascade,
  boxes int check (boxes >= 0),
  pallet text not null default '',
  updated_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Triggers
create trigger weeks_updated_at before update on public.weeks
  for each row execute function public.set_updated_at();
create trigger weeks_audit after insert or update or delete on public.weeks
  for each row execute function public.audit_row();

create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger orders_audit after insert or update or delete on public.orders
  for each row execute function public.audit_row();

create trigger order_lines_updated_at before update on public.order_lines
  for each row execute function public.set_updated_at();
create trigger order_lines_audit after insert or update or delete on public.order_lines
  for each row execute function public.audit_row('order_id', 'product_id');

create trigger packing_lines_updated_at before update on public.packing_lines
  for each row execute function public.set_updated_at();
create trigger packing_lines_audit after insert or update or delete on public.packing_lines
  for each row execute function public.audit_row('order_id', 'product_id');

create trigger packing_orders_updated_at before update on public.packing_orders
  for each row execute function public.set_updated_at();
create trigger packing_orders_audit after insert or update or delete on public.packing_orders
  for each row execute function public.audit_row('order_id');

-- RLS
alter table public.weeks enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.packing_lines enable row level security;
alter table public.packing_orders enable row level security;

create policy "weeks: staff all" on public.weeks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "weeks: packing read" on public.weeks
  for select to authenticated using (public.app_role() = 'packing');

create policy "orders: staff all" on public.orders
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "orders: packing read" on public.orders
  for select to authenticated using (public.app_role() = 'packing');

create policy "order_lines: staff all" on public.order_lines
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "order_lines: packing read" on public.order_lines
  for select to authenticated using (public.app_role() = 'packing');

create policy "packing_lines: active users all" on public.packing_lines
  for all to authenticated
  using (public.app_role() in ('admin', 'office', 'packing'))
  with check (public.app_role() in ('admin', 'office', 'packing'));

create policy "packing_orders: active users all" on public.packing_orders
  for all to authenticated
  using (public.app_role() in ('admin', 'office', 'packing'))
  with check (public.app_role() in ('admin', 'office', 'packing'));

-- Grants
revoke all on public.weeks, public.orders, public.order_lines, public.packing_lines, public.packing_orders from anon;
grant select, insert, update, delete on public.weeks, public.orders, public.order_lines, public.packing_lines, public.packing_orders to authenticated;
