-- Undo 20261107000100_whole_pieces_from_pounds.sql: pounds become exact
-- (fractional) pieces again.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261107000100_revert.sql

begin;
create or replace function public.qty_in_product_unit(p_qty numeric, p_line_unit text, p_unit text, p_lb_per_unit numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_line_unit is null or p_line_unit = p_unit then p_qty
    when p_line_unit = 'lb' then coalesce(p_qty / nullif(p_lb_per_unit, 0), 0)
    when p_unit = 'lb' then coalesce(p_qty * p_lb_per_unit, 0)
    else p_qty
  end;
$$;
delete from supabase_migrations.schema_migrations where version = '20261107000100';
commit;
