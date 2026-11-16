-- Undo 20261115000400_pnl_adjustments.sql: removes P&L adjustments, one-off
-- lines and expense attachments (the tables, their functions, the bucket's
-- policies). Files in the pnl-files bucket are left; delete the bucket in the
-- Supabase dashboard if wanted. Audit log rows stay, as a record.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261115000400_revert.sql

begin;
alter publication supabase_realtime drop table public.pnl_adjustments, public.pnl_expense_files;
drop table if exists public.pnl_expense_files;
drop table if exists public.pnl_adjustments;
drop function if exists public.pnl_adjustments_guard();
drop policy if exists "pnl-files: read" on storage.objects;
drop policy if exists "pnl-files: add" on storage.objects;
drop policy if exists "pnl-files: delete" on storage.objects;
delete from supabase_migrations.schema_migrations where version = '20261115000400';
commit;
