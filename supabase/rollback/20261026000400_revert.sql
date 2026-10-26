-- Undo 20261026000400_pallet_customers.sql: removes the weekly pallet plan
-- (which stores go on which pallet). Pallets and boxes are kept.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000400_revert.sql

begin;
alter publication supabase_realtime drop table public.pallet_customers;
drop table if exists public.pallet_customers;
delete from supabase_migrations.schema_migrations where version = '20261026000400';
commit;
