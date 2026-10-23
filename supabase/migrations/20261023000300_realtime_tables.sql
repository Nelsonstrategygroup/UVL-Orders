-- Live updates for the tables some screens listen to but the database didn't
-- send changes for (found 10/23/26). A screen subscribed to a table missing
-- here got no live updates at all: Freezer, Half and whole, and Setup's
-- pallet groups and box labels (GTINs) only refreshed when reopened. Packing
-- also listens to box limits, GTINs and lots for scanning on several phones.
-- Undo: supabase/rollback/20261023000300_revert.sql

alter publication supabase_realtime add table
  public.freezer_log,
  public.half_whole_orders,
  public.pallet_groups,
  public.gtin_products,
  public.lots,
  public.product_box_limits;
