-- Undo 20261114000300_weekly_pnl.sql: removes the P&L tables (per-lamb and
-- percent charges, expense categories, expense and income entries) and the
-- order_week function. Nothing else. Audit log rows stay, as a record.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261114000300_revert.sql

begin;
alter publication supabase_realtime drop table public.pnl_income, public.pnl_expenses,
  public.expense_categories, public.pnl_percent_charges, public.pnl_lamb_charges;
drop table if exists public.pnl_income;
drop table if exists public.pnl_expenses;
drop table if exists public.expense_categories;
drop table if exists public.pnl_percent_charges;
drop table if exists public.pnl_lamb_charges;
drop function if exists public.order_week(date);
delete from supabase_migrations.schema_migrations where version = '20261114000300';
commit;
