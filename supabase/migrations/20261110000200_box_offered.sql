-- How a scanned box was routed, in words that explain a mistake (Lucas,
-- 11/10/26, after Burien's Front Shanks box showed route "other" and
-- Emerson as suggested_order_id). Since 10/26/26 nothing is chosen for
-- Chris when more than one store needs a product: he taps the store on the
-- box's label. suggested_order_id held the store the app's ranking would
-- have put first, which Chris never saw, so it couldn't explain anything.
--
-- packing_weights.offered: the stores on Chris's screen when he tapped one,
-- as shown ("#12 Redmond, #17 Burien, Emerson"). The store he tapped is the
-- box's order. The app stops sending suggested_order_id; it stays for older
-- boxes (and older phones). route keeps its values:
--   suggested   only one store needed it (chosen for Chris, one tap)
--   other       tapped from several stores (offered lists them)
--   picked      picked by hand from the full list
--   locked      store picked first (Lock to a customer)
--   unassigned  no store needed it

alter table public.packing_weights add column offered text;
comment on column public.packing_weights.offered is 'The stores on Chris''s screen when he tapped this box''s store, as shown ("#12 Redmond, #17 Burien, Emerson"). Blank for boxes before 11/10/26, typed boxes, and boxes with only one choice.';
comment on column public.packing_weights.suggested_order_id is 'Before 11/10/26: the store the app''s ranking would have put first when Chris chose another. Never shown to Chris; kept for older boxes. See offered.';

create or replace function public.record_box(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client uuid := (p ->> 'client_id')::uuid;
  -- Null for an unassigned box (no open order needed it); then week_id says which week.
  v_order uuid := nullif(p ->> 'order_id', '')::uuid;
  v_week date := nullif(p ->> 'week_id', '')::date;
  v_pallet uuid := nullif(p ->> 'pallet_id', '')::uuid;
  v_box_type text := nullif(p ->> 'box_type_id', '');
  v_route text := nullif(p ->> 'route', '');
  v_suggested uuid := nullif(p ->> 'suggested_order_id', '')::uuid;
  -- The stores on Chris's screen when he tapped one (11/10/26), as shown.
  v_offered text := nullif(left(btrim(coalesce(p ->> 'offered', '')), 500), '');
  v_planned int := nullif(p ->> 'planned_boxes', '')::int;
  v_count int;
  v_product text := p ->> 'product_id';
  v_source text := coalesce(p ->> 'source', 'scan');
  v_gtin text := nullif(p ->> 'gtin', '');
  v_serial text := nullif(p ->> 'serial', '');
  v_pack date := nullif(p ->> 'pack_date', '')::date;
  v_lot text := nullif(btrim(coalesce(p ->> 'lot', '')), '');
  v_off boolean := coalesce((p ->> 'off_order')::boolean, false);
  v_existing record;
  v_known text;
  v_mapped text;
  v_id uuid;
  v_box int;
  -- Which box of this customer's product (its place on the packing sheet) and its label number.
  v_slot int := nullif(p ->> 'slot', '')::int;
  v_label int := nullif(p ->> 'label_no', '')::int;
begin
  if not public.can_change('packing') then
    raise exception 'You don''t have permission to pack.' using errcode = '42501';
  end if;
  if v_client is null then
    raise exception 'client_id is required.' using errcode = '22023';
  end if;
  if v_source not in ('scan', 'manual') then
    raise exception 'source must be scan or manual.' using errcode = '22023';
  end if;

  -- Sent before (a retry after a dropped connection).
  select id into v_id from public.packing_weights where client_id = v_client;
  if v_id is not null then
    return jsonb_build_object('status', 'already', 'id', v_id);
  end if;

  -- The same box recorded already, from this phone or another.
  if v_serial is not null then
    select w.id, w.order_id, c.name as customer into v_existing
    from public.packing_weights w
    left join public.orders o on o.id = w.order_id
    left join public.customers c on c.id = o.customer_id
    where w.gtin = v_gtin and w.serial = v_serial;
    if v_existing.id is not null then
      insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
      values ('duplicate-box',
              format('Box %s was scanned twice. It is already recorded for %s.', v_serial, coalesce(v_existing.customer, 'unassigned boxes')),
              v_order, v_product, v_gtin, v_serial, v_client, p);
      return jsonb_build_object('status', 'duplicate', 'id', v_existing.id, 'customer', coalesce(v_existing.customer, 'unassigned boxes'));
    end if;
  end if;

  if v_order is null and v_week is null then
    raise exception 'A box needs an order or a week.' using errcode = '22023';
  end if;
  if v_order is not null and not exists (select 1 from public.orders where id = v_order) then
    insert into public.packing_conflicts (kind, message, product_id, gtin, serial, client_id, details)
    values ('order-gone', 'A box was scanned for an order that no longer exists.', v_product, v_gtin, v_serial, v_client, p);
    return jsonb_build_object('status', 'gone');
  end if;

  if v_lot is null then
    raise exception 'Every box needs a lot.' using errcode = '23514';
  end if;

  -- Box numbers run 1, 2, 3 within an order.
  select coalesce(max(box_no), 0) + 1 into v_box from public.packing_weights where order_id = v_order;
  if v_order is not null then v_box := coalesce(v_box, 1); else v_box := null; end if;

  insert into public.packing_weights (
    order_id, week_id, box_type_id, route, suggested_order_id, product_id, weight, box_no, slot, label_no, source, gtin, serial, serial_date, case_no, pack_date, lot,
    pallet_id, raw_scan, photo_path, client_id, scanned_at, off_order, offered
  ) values (
    v_order, case when v_order is null then v_week end, v_box_type, v_route, v_suggested, v_product, (p ->> 'weight')::numeric, v_box, v_slot, v_label, v_source, v_gtin, v_serial,
    nullif(p ->> 'serial_date', '')::date, nullif(p ->> 'case_no', ''), v_pack, v_lot,
    v_pallet, nullif(p ->> 'raw_scan', ''), nullif(p ->> 'photo_path', ''),
    v_client, coalesce(nullif(p ->> 'scanned_at', '')::timestamptz, now()), v_off, v_offered
  ) returning id into v_id;

  -- Remember the lot for this GTIN + pack date, or flag one that differs.
  if v_gtin is not null and v_pack is not null then
    select lot into v_known from public.lots where gtin = v_gtin and pack_date = v_pack;
    if v_known is null then
      insert into public.lots (gtin, pack_date, lot) values (v_gtin, v_pack, v_lot) on conflict do nothing;
    elsif v_known <> v_lot then
      insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
      values ('lot-differs',
              format('Box %s has lot %s, but lot %s is on file for this product and pack date.', coalesce(v_serial, '(no serial)'), v_lot, v_known),
              v_order, v_product, v_gtin, v_serial, v_client, p);
    end if;
  end if;

  -- A GTIN mapped to a different product than the box was saved as.
  if v_gtin is not null then
    select product_id into v_mapped from public.gtin_products where gtin = v_gtin;
    if v_mapped is not null and v_mapped <> v_product then
      insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
      values ('gtin-differs', 'A box was saved as a different product than its label''s GTIN is set to.',
              v_order, v_product, v_gtin, v_serial, v_client, p);
    end if;
  end if;

  -- The product isn't on the order any more (and the packer didn't choose to add it).
  if v_order is not null and not v_off and not exists (select 1 from public.order_lines where order_id = v_order and product_id = v_product) then
    insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
    values ('order-changed', 'A box was packed for a product that is no longer on this order.',
            v_order, v_product, v_gtin, v_serial, v_client, p);
  end if;

  -- More boxes than planned (two phones packing the same line offline): saved, and flagged for Kathy.
  if v_order is not null and v_planned is not null then
    select count(*) into v_count from public.packing_weights where order_id = v_order and product_id = v_product;
    if v_count > v_planned then
      insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
      values ('over-packed', format('%s boxes are packed where %s were planned.', v_count, v_planned),
              v_order, v_product, v_gtin, v_serial, v_client, p);
    end if;
  end if;

  return jsonb_build_object('status', 'saved', 'id', v_id, 'box_no', v_box);
end;
$$;


revoke all on function public.record_box(jsonb) from public, anon;
grant execute on function public.record_box(jsonb) to authenticated, service_role;
