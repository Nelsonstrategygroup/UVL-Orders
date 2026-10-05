-- Phase 3: the database records who packed each line and when, and who last
-- changed an order's boxes and pallet. Devices can't set these themselves.

create or replace function public.stamp_packing_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Scripts using the service role have no auth.uid(); keep what they sent.
  new.packed_by := coalesce(auth.uid(), new.packed_by);
  new.packed_at := now();
  return new;
end;
$$;

create trigger packing_lines_stamp
  before insert or update on public.packing_lines
  for each row execute function public.stamp_packing_line();

create or replace function public.stamp_packing_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger packing_orders_stamp
  before insert or update on public.packing_orders
  for each row execute function public.stamp_packing_order();

revoke execute on function public.stamp_packing_line(), public.stamp_packing_order() from public, anon, authenticated;
