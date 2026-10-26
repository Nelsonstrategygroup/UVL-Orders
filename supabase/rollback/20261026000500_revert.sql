-- Undo 20261026000500_ship_from_address.sql: removes the ship-from address.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000500_revert.sql

begin;
alter table public.app_settings drop column if exists ship_from_address;
delete from supabase_migrations.schema_migrations where version = '20261026000500';
commit;
