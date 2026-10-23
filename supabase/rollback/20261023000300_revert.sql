-- Undo 20261023000300_realtime_tables.sql: stop sending live changes for these tables.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261023000300_revert.sql

begin;

alter publication supabase_realtime drop table
  public.freezer_log,
  public.half_whole_orders,
  public.pallet_groups,
  public.gtin_products,
  public.lots,
  public.product_box_limits;

delete from supabase_migrations.schema_migrations where version = '20261023000300';

commit;
