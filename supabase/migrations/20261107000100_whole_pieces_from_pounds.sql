-- Pieces are whole (Lucas, 11/7/26): a line taken in pounds of a product
-- counted in pieces (BNLS Shoulder) becomes whole pieces once, to the nearest
-- piece, and never less than 1 (20 lb of 4.5 lb shoulders is 4; 120 lb is
-- 27). The app does the same in lib/calc/units.ts (toProductUnit), so the cut
-- sheet's "put these on this set" agrees with the labels and the lamb count.
-- Pieces into pounds stay exact. Undo: supabase/rollback/20261107000100_revert.sql

create or replace function public.qty_in_product_unit(p_qty numeric, p_line_unit text, p_unit text, p_lb_per_unit numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_line_unit is null or p_line_unit = p_unit then p_qty
    when p_line_unit = 'lb' then
      case when coalesce(p_lb_per_unit, 0) > 0 and p_qty > 0 then greatest(1, round(p_qty / p_lb_per_unit)) else 0 end
    when p_unit = 'lb' then coalesce(p_qty * p_lb_per_unit, 0)
    else p_qty
  end;
$$;
