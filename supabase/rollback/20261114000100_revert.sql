-- Undo 20261114000100_lamb_cost_setup.sql: removes the three Lamb cost
-- Setup tables (producers, pricing settings, producer rates) and nothing
-- else. Their audit log rows stay, as a record.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261114000100_revert.sql

begin;
alter publication supabase_realtime drop table public.producer_rates, public.lamb_cost_settings, public.producers;
drop table if exists public.producer_rates;
drop table if exists public.lamb_cost_settings;
drop table if exists public.producers;
delete from supabase_migrations.schema_migrations where version = '20261114000100';
commit;
