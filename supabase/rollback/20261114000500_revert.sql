-- Undo 20261114000500_price_checks.sql: removes the Prices confirmed table
-- and its trigger function. Nothing else. Audit log rows stay, as a record.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261114000500_revert.sql

begin;
alter publication supabase_realtime drop table public.customer_price_checks;
drop table if exists public.customer_price_checks;
drop function if exists public.customer_price_checks_stamp();
delete from supabase_migrations.schema_migrations where version = '20261114000500';
commit;
