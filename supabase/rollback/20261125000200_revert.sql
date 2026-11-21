-- Undoes 20261125000200_pnl_freezer_lines.sql.
-- Adjustments made to Into freezer or Out of freezer must go first (they'd break the old rule):
-- they're voided, not deleted, in the app, so delete them here only after a backup.

delete from public.pnl_adjustments where line_key in ('freezer_in', 'freezer_out');

alter table public.pnl_adjustments
  drop constraint pnl_adjustments_line_key_check,
  add constraint pnl_adjustments_line_key_check check (
    line_key is null or line_key = any (array['income', 'producer']) or line_key ~ '^(charge|category):.+$'),
  drop constraint pnl_adjustments_side,
  add constraint pnl_adjustments_side check (
    line_key is null or side = case when line_key = 'income' then 'income' else 'expense' end);
