-- Plan pallets for the week (Lucas, 10/26/26): which customers or stores go
-- on which pallet. A PCC shipment fills several pallets, each with its own
-- stores (P1: #10, #11, #13...; P2: #24, #17...), and the groups are often
-- the same each week. Chris (at Mohawk) or Kathy sets them on the Pallets
-- page, or starts from last week's; Scan boxes then sends a store's boxes to
-- its pallet (still one tap to confirm). Nothing prints on box labels.
-- A customer is on one pallet a week (the app moves it when it's put on
-- another). Planned pallets are status 'planned' until the first box.
-- Undo: supabase/rollback/20261026000400_revert.sql

create table public.pallet_customers (
  pallet_id uuid not null references public.pallets (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pallet_id, customer_id)
);
comment on table public.pallet_customers is 'The customers (stores) planned onto a pallet for its week. Boxes still record their own pallet in packing_weights.';
create index pallet_customers_customer_idx on public.pallet_customers (customer_id);
create trigger pallet_customers_audit after insert or update or delete on public.pallet_customers
  for each row execute function public.audit_row('pallet_id', 'customer_id');

alter table public.pallet_customers enable row level security;
create policy "pallet_customers: read" on public.pallet_customers for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "pallet_customers: change" on public.pallet_customers for all to authenticated
  using ((select public.can_change('packing') or public.can_change('week')))
  with check ((select public.can_change('packing') or public.can_change('week')));
revoke all on public.pallet_customers from anon;
grant select, insert, update, delete on public.pallet_customers to authenticated;

alter publication supabase_realtime add table public.pallet_customers;
