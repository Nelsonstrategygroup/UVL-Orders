-- Undoes 20261123000100_box_counts_toward.sql. Boxes go back to their label product.
-- Run 20261123000200_revert.sql first.

drop trigger if exists order_lines_box_counts on public.order_lines;
drop trigger if exists packing_weights_counts_as on public.packing_weights;
drop function if exists public.order_lines_box_counts();
drop function if exists public.refresh_box_counts(uuid);
drop function if exists public.packing_weights_counts_as();
drop function if exists public.box_counts_as(uuid, text, uuid);

update public.packing_weights w
set product_id = w.label_product_id,
    off_order = not public.box_on_order(w.order_id, w.label_product_id)
where w.label_product_id is not null;

drop function if exists public.box_on_order(uuid, text);

update public.products
set draws_from = array['hshank', 'fshank']
where id = 'd090766f-1126-49a9-be72-c6ad0b8b36d3';

alter table public.packing_weights
  drop constraint if exists packing_weights_correction_reason,
  drop column if exists label_product_id,
  drop column if exists corrected_at,
  drop column if exists corrected_by,
  drop column if exists correction_reason;
alter table public.products drop column if exists fills_product_id;
