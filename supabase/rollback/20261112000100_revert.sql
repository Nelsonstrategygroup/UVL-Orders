-- Undo 20261112000100_draws_from_parts.sql: Mixed Shanks is no longer shown
-- against the front and hind shanks (it isn't in the balance at all, as
-- before). Take the app back to a version before 11/12/26 first: the app
-- reads this column when it loads products.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261112000100_revert.sql

begin;
alter table public.products drop column if exists draws_from;
delete from supabase_migrations.schema_migrations where version = '20261112000100';
commit;
