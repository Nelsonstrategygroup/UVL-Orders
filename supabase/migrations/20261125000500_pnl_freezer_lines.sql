-- Weekly P&L: Into freezer and Out of freezer (Kathy's rule, Lucas 11/20/26).
--
-- Product put in the freezer counts as income for its week at 90% of its
-- default sale price (freezer_boxes + freezer_box_values, migration
-- 20261125000400); what comes out to fill an order takes that back, at the
-- value it went in at. The P&L works the lines out (lib/calc/freezer.ts);
-- this only lets an adjustment be made to either line, like Income.
--
-- Undo: supabase/rollback/20261125000500_revert.sql

alter table public.pnl_adjustments
  drop constraint pnl_adjustments_line_key_check,
  add constraint pnl_adjustments_line_key_check check (
    line_key is null
    or line_key = any (array['income', 'producer', 'freezer_in', 'freezer_out'])
    or line_key ~ '^(charge|category):.+$'),
  drop constraint pnl_adjustments_side,
  add constraint pnl_adjustments_side check (
    line_key is null
    or side = case when line_key in ('income', 'freezer_in', 'freezer_out') then 'income' else 'expense' end);
