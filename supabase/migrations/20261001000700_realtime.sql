-- Realtime (4.9). Changes on these tables are pushed to open screens, so an
-- order entered on one device shows on the packing tablet within seconds.
-- Realtime respects RLS, so packing users only receive what they can read.

-- Full replica identity so DELETE events carry the whole old row
-- (needed to remove a deleted order line from another screen).
alter table public.orders replica identity full;
alter table public.order_lines replica identity full;
alter table public.packing_lines replica identity full;
alter table public.packing_orders replica identity full;
alter table public.cut_sets replica identity full;
alter table public.cut_set_lines replica identity full;
alter table public.cut_sheets replica identity full;

alter publication supabase_realtime add table
  public.orders,
  public.order_lines,
  public.packing_lines,
  public.packing_orders,
  public.cut_sets,
  public.cut_set_lines,
  public.cut_sheets;
