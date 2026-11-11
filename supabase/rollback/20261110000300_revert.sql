-- Undo 20261110000300_hlk_group_name.sql: the group of Heart, Liver and
-- Kidney is labelled Organs again. Nothing else changes.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261110000300_revert.sql

begin;
update public.products set packed_with = 'Organs' where packed_with = 'HLK';
delete from supabase_migrations.schema_migrations where version = '20261110000300';
commit;
