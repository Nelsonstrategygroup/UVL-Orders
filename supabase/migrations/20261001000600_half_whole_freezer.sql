-- Half and whole lambs, freezer (4.6).

create table public.half_whole_orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null default '',
  phone text not null default '',
  size text not null check (size in ('half', 'whole')),
  status text not null default 'pending' check (status in ('pending', 'filled', 'cancelled')),
  need_by date,
  notes text not null default '',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- One row per slot (a whole lamb has 2 leg slots, 2 shoulder slots, and so on).
create table public.half_whole_choices (
  order_id uuid not null references public.half_whole_orders (id) on delete cascade,
  part_id text not null references public.parts (id) on delete restrict,
  slot int not null check (slot >= 0),
  product_id text references public.products (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (order_id, part_id, slot)
);

-- Positive qty is cuts put in, negative is cuts taken out.
create table public.freezer_log (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default ((now() at time zone 'America/Los_Angeles')::date),
  product_id text not null references public.products (id) on delete restrict,
  qty numeric not null check (qty <> 0),
  note text not null default '',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index freezer_log_product_idx on public.freezer_log (product_id);

-- Triggers
create trigger half_whole_orders_updated_at before update on public.half_whole_orders
  for each row execute function public.set_updated_at();
create trigger half_whole_orders_audit after insert or update or delete on public.half_whole_orders
  for each row execute function public.audit_row();

create trigger half_whole_choices_updated_at before update on public.half_whole_choices
  for each row execute function public.set_updated_at();
create trigger half_whole_choices_audit after insert or update or delete on public.half_whole_choices
  for each row execute function public.audit_row('order_id', 'part_id', 'slot');

create trigger freezer_log_updated_at before update on public.freezer_log
  for each row execute function public.set_updated_at();
create trigger freezer_log_audit after insert or update or delete on public.freezer_log
  for each row execute function public.audit_row();

-- RLS: office and admin only.
alter table public.half_whole_orders enable row level security;
alter table public.half_whole_choices enable row level security;
alter table public.freezer_log enable row level security;

create policy "half_whole_orders: staff all" on public.half_whole_orders
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "half_whole_choices: staff all" on public.half_whole_choices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "freezer_log: staff all" on public.freezer_log
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Grants
revoke all on public.half_whole_orders, public.half_whole_choices, public.freezer_log from anon;
grant select, insert, update, delete on public.half_whole_orders, public.half_whole_choices, public.freezer_log to authenticated;
