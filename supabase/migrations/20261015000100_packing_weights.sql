-- Stage 3: packing by weight (change requests 10/2026, item 6).
--
-- Chris enters the actual weight of what he packs. A line can have several
-- weights (one per box or case: Le Trim "3cs: 53.65, 84.8, 87.65"). Each
-- weight can go in a numbered box for that customer; weights from different
-- lines in the same box make a mixed box. A line can be marked not filled
-- (the X on the paper sheet) or flagged with a note. These weights are what
-- invoices will use.
--
-- Pallet groups: which customers ship together, and where on the pallet.
-- The Packing screen lists customers in that order.

-- ---------------------------------------------------------------------------
-- Weights.
-- ---------------------------------------------------------------------------
create table public.packing_weights (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id) on delete restrict,
  weight numeric not null check (weight > 0),
  box_no int check (box_no >= 1),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index packing_weights_order_idx on public.packing_weights (order_id);

create trigger packing_weights_updated_at before update on public.packing_weights
  for each row execute function public.set_updated_at();
create trigger packing_weights_audit after insert or update or delete on public.packing_weights
  for each row execute function public.audit_row();

-- Who weighed it comes from the login, not the device.
create or replace function public.stamp_packing_weight()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;
create trigger packing_weights_stamp before insert on public.packing_weights
  for each row execute function public.stamp_packing_weight();

alter table public.packing_weights enable row level security;
create policy "packing_weights: read" on public.packing_weights for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "packing_weights: change" on public.packing_weights for all to authenticated
  using ((select public.can_change('packing'))) with check ((select public.can_change('packing')));
revoke all on public.packing_weights from anon;
grant select, insert, update, delete on public.packing_weights to authenticated;

-- ---------------------------------------------------------------------------
-- Line marks. packed_qty is now an optional count of pieces (for orders
-- taken in pieces or packs); the weight is the main record.
-- ---------------------------------------------------------------------------
alter table public.packing_lines alter column packed_qty drop not null;
alter table public.packing_lines
  add column shorted boolean not null default false,
  add column flagged boolean not null default false,
  add column flag_note text not null default '';

-- ---------------------------------------------------------------------------
-- Pallet groups.
-- ---------------------------------------------------------------------------
create table public.pallet_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger pallet_groups_updated_at before update on public.pallet_groups
  for each row execute function public.set_updated_at();
create trigger pallet_groups_audit after insert or update or delete on public.pallet_groups
  for each row execute function public.audit_row();

alter table public.pallet_groups enable row level security;
create policy "pallet_groups: read" on public.pallet_groups for select to authenticated
  using ((select public.can_view_any(array['packing', 'customers', 'setup', 'orders', 'downloads'])));
create policy "pallet_groups: change" on public.pallet_groups for all to authenticated
  using ((select public.can_change('setup'))) with check ((select public.can_change('setup')));
revoke all on public.pallet_groups from anon;
grant select, insert, update, delete on public.pallet_groups to authenticated;

-- Each customer's group, where on the pallet ("Left half", "Top"), and order within the group.
alter table public.customers
  add column pallet_group_id uuid references public.pallet_groups (id) on delete set null,
  add column pallet_spot text not null default '',
  add column pallet_sort int not null default 0;
