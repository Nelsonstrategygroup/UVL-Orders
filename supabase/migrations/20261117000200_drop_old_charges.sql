-- The P&L charges became expense categories (20261117000100, Lucas
-- 11/16/26): every per-lamb and percent charge and its dates were copied
-- into expense_categories and expense_category_rates, and the app reads
-- those now. Removes the old tables. Apply after the app that reads the
-- categories is deployed.
--
-- Undo: supabase/rollback/20261117000200_revert.sql

drop table public.pnl_lamb_charges;
drop table public.pnl_percent_charges;
