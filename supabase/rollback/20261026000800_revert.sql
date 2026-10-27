-- Undo 20261026000800_extra_ok.sql: removes the "correct for the shipment" check on boxes not on the order.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000800_revert.sql

begin;
alter table public.packing_weights drop column if exists extra_ok_by, drop column if exists extra_ok_at;
delete from supabase_migrations.schema_migrations where version = '20261026000800';
commit;
