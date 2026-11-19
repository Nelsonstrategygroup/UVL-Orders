-- Correct a box's product by hand (Lucas, 11/18/26): for a mislabeled box.
-- A required reason; who and when are kept, and so are the product on the
-- label, the GTIN and the serial. product_id changes, so the invoice,
-- inventory and lot trace follow. The GTIN's product mapping is not touched.
-- Refused on a finalized invoice; a closed week refuses it on its own.
--
-- Also fixes Bothell's 20.40 lb box (2632010181), labeled Trim 5 lb, really Le Trim.
--
-- Undo: supabase/rollback/20261123000200_revert.sql

create or replace function public.correct_box_product(p_box uuid, p_product text, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  w record;
  v_label text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_slot int;
begin
  if not public.can_change('packing') then
    raise exception 'You don''t have permission to change boxes.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Type why the product is changing.' using errcode = '22023';
  end if;
  select pw.id, pw.order_id, pw.product_id, pw.label_product_id, pw.slot, o.week_id, o.customer_id into w
  from public.packing_weights pw
  left join public.orders o on o.id = pw.order_id
  where pw.id = p_box;
  if w.id is null then
    raise exception 'That box is gone.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.products where id = p_product) then
    raise exception 'Pick a product.' using errcode = '22023';
  end if;
  if w.order_id is not null and exists (
    select 1 from public.invoices i
    where i.week_id = w.week_id and i.customer_id = w.customer_id and i.status in ('finalized', 'sent')
  ) then
    raise exception 'This store''s invoice is finalized. Reopen the invoice first.' using errcode = 'P0001';
  end if;

  v_label := coalesce(w.label_product_id, w.product_id);
  perform set_config('uvl.source', 'box product corrected (Packing): ' || v_reason, true);

  -- Back to what the label says: no longer a correction.
  if p_product = v_label then
    update public.packing_weights
    set product_id = p_product, label_product_id = null,
        corrected_at = null, corrected_by = null, correction_reason = null,
        off_order = w.order_id is not null and not public.box_on_order(w.order_id, p_product)
    where id = p_box;
    return;
  end if;

  v_slot := w.slot;
  if w.order_id is not null and p_product is distinct from w.product_id then
    select coalesce(max(x.slot), 0) + 1 into v_slot
    from public.packing_weights x where x.order_id = w.order_id and x.product_id = p_product;
  end if;
  update public.packing_weights
  set product_id = p_product,
      label_product_id = v_label,
      corrected_at = now(),
      corrected_by = auth.uid(),
      correction_reason = v_reason,
      off_order = w.order_id is not null and not public.box_on_order(w.order_id, p_product),
      extra_ok_by = null,
      extra_ok_at = null,
      slot = v_slot,
      label_no = case when p_product is distinct from w.product_id then null else label_no end
  where id = p_box;
end;
$$;
revoke execute on function public.correct_box_product(uuid, text, text) from public, anon;
grant execute on function public.correct_box_product(uuid, text, text) to authenticated, service_role;

-- Bothell, week of Nov 16: labeled Trim 5 lb, really Le Trim.
select set_config('uvl.source', 'box product corrected (Lucas, 11/18/26)', true);
update public.packing_weights w
set product_id = 'cp-le-trim',
    label_product_id = 'cp-trim-5',
    corrected_at = now(),
    corrected_by = (select p.id from public.profiles p where p.display_name = 'Lucas Nelson' limit 1),
    correction_reason = 'Mislabeled: the label says Trim 5 lb, the box is Le Trim.',
    off_order = false,
    extra_ok_by = null,
    extra_ok_at = null,
    slot = (select coalesce(max(x.slot), 0) + 1 from public.packing_weights x where x.order_id = w.order_id and x.product_id = 'cp-le-trim'),
    label_no = null
from public.orders o
where o.id = w.order_id
  and w.serial = '2632010181'
  and w.product_id = 'cp-trim-5'
  and o.week_id = '2026-11-16'
  and not exists (select 1 from public.invoices i where i.week_id = o.week_id and i.customer_id = o.customer_id and i.status in ('finalized', 'sent'));
select set_config('uvl.source', '', true);
