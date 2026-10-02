-- Catalog (4.2): parts, cut specs, products, product part uses, size classes.
-- Seeded from reference/seed-data.json by scripts/seed.ts.

create table public.parts (
  id text primary key,
  name text not null,
  per_lamb numeric not null check (per_lamb >= 0),
  unit text not null check (unit in ('each', 'lb')),
  balance_check boolean not null default false,
  confirmed boolean not null default false,
  source_note text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.cut_specs (
  id text primary key default gen_random_uuid()::text,
  text text not null,
  use_type text not null check (use_type in (
    'leg', 'legshank', 'shoulder', 'rack', 'loin', 'wholeloin', 'saddle',
    'fshank', 'hshank', 'allshank', 'carcass', 'none'
  )),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table public.products (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  short_name text not null default '',
  unit text not null check (unit in ('each', 'lb', 'leg', 'loin', 'lamb')),
  group_name text not null check (group_name in (
    'Legs', 'Shoulders', 'Racks', 'Loins', 'Shanks', 'Ground and trim', 'Whole lambs', 'Other'
  )),
  cut_spec_id text references public.cut_specs (id) on delete set null,
  fresh_only boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index products_cut_spec_idx on public.products (cut_spec_id);

create table public.product_part_uses (
  product_id text not null references public.products (id) on delete cascade,
  part_id text not null references public.parts (id) on delete restrict,
  qty numeric not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (product_id, part_id)
);

create table public.size_classes (
  id text primary key,
  label text not null,
  weight_range text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Triggers
create trigger parts_updated_at before update on public.parts
  for each row execute function public.set_updated_at();
create trigger parts_audit after insert or update or delete on public.parts
  for each row execute function public.audit_row();

create trigger cut_specs_updated_at before update on public.cut_specs
  for each row execute function public.set_updated_at();
create trigger cut_specs_audit after insert or update or delete on public.cut_specs
  for each row execute function public.audit_row();

create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_row();

create trigger product_part_uses_updated_at before update on public.product_part_uses
  for each row execute function public.set_updated_at();
create trigger product_part_uses_audit after insert or update or delete on public.product_part_uses
  for each row execute function public.audit_row('product_id', 'part_id');

create trigger size_classes_updated_at before update on public.size_classes
  for each row execute function public.set_updated_at();
create trigger size_classes_audit after insert or update or delete on public.size_classes
  for each row execute function public.audit_row();

-- RLS
alter table public.parts enable row level security;
alter table public.cut_specs enable row level security;
alter table public.products enable row level security;
alter table public.product_part_uses enable row level security;
alter table public.size_classes enable row level security;

create policy "parts: staff all" on public.parts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "cut_specs: staff all" on public.cut_specs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "product_part_uses: staff all" on public.product_part_uses
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "size_classes: staff all" on public.size_classes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "products: staff all" on public.products
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "products: packing read" on public.products
  for select to authenticated using (public.app_role() = 'packing');

-- Grants
revoke all on public.parts, public.cut_specs, public.products, public.product_part_uses, public.size_classes from anon;
grant select, insert, update, delete on public.parts, public.cut_specs, public.products, public.product_part_uses, public.size_classes to authenticated;
