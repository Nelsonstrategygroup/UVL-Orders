-- Undoes 20261123000200_correct_box_product.sql. Corrected boxes go back to their label product.

update public.packing_weights w
set product_id = w.label_product_id,
    off_order = not public.box_on_order(w.order_id, w.label_product_id),
    label_product_id = null,
    corrected_at = null,
    corrected_by = null,
    correction_reason = null
where w.correction_reason is not null;

drop function if exists public.correct_box_product(uuid, text, text);
