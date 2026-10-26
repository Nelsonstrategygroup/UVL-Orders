-- Undo 20261026000200_pallet_routing.sql: removes distributors, Ships to,
-- shipments, pallet tags and status, plan lines, box sizes, and the box
-- routing fields; puts record_box() back. Unassigned boxes (no order) are
-- deleted first, since every box must then belong to an order.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000200_revert.sql

begin;

alter publication supabase_realtime drop table public.shipments, public.pallet_shipments, public.pallet_plan_lines, public.consolidation_points;
drop function if exists public.start_pallet(jsonb);

create or replace function public.record_box(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client uuid := (p ->> 'client_id')::uuid;
  v_order uuid := (p ->> 'order_id')::uuid;
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
    join public.orders o on o.id = w.order_id
    join public.customers c on c.id = o.customer_id
    where w.gtin = v_gtin and w.serial = v_serial;
    if v_existing.id is not null then
      insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
      values ('duplicate-box',
              format('Box %s was scanned twice. It is already recorded for %s.', v_serial, v_existing.customer),
              v_order, v_product, v_gtin, v_serial, v_client, p);
      return jsonb_build_object('status', 'duplicate', 'id', v_existing.id, 'customer', v_existing.customer);
    end if;
  end if;

  if not exists (select 1 from public.orders where id = v_order) then
    insert into public.packing_conflicts (kind, message, product_id, gtin, serial, client_id, details)
    values ('order-gone', 'A box was scanned for an order that no longer exists.', v_product, v_gtin, v_serial, v_client, p);
    return jsonb_build_object('status', 'gone');
  end if;

  if v_lot is null then
    raise exception 'Every box needs a lot.' using errcode = '23514';
  end if;

  -- Box numbers run 1, 2, 3 within an order.
  select coalesce(max(box_no), 0) + 1 into v_box from public.packing_weights where order_id = v_order;

  insert into public.packing_weights (
    order_id, product_id, weight, box_no, slot, label_no, source, gtin, serial, serial_date, case_no, pack_date, lot,
    pallet_id, raw_scan, photo_path, client_id, scanned_at, off_order
  ) values (
    v_order, v_product, (p ->> 'weight')::numeric, v_box, v_slot, v_label, v_source, v_gtin, v_serial,
    nullif(p ->> 'serial_date', '')::date, nullif(p ->> 'case_no', ''), v_pack, v_lot,
    nullif(p ->> 'pallet_id', '')::uuid, nullif(p ->> 'raw_scan', ''), nullif(p ->> 'photo_path', ''),
    v_client, coalesce(nullif(p ->> 'scanned_at', '')::timestamptz, now()), v_off
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
  if not v_off and not exists (select 1 from public.order_lines where order_id = v_order and product_id = v_product) then
    insert into public.packing_conflicts (kind, message, order_id, product_id, gtin, serial, client_id, details)
    values ('order-changed', 'A box was packed for a product that is no longer on this order.',
            v_order, v_product, v_gtin, v_serial, v_client, p);
  end if;

  return jsonb_build_object('status', 'saved', 'id', v_id, 'box_no', v_box);
end;
$$;

revoke all on function public.record_box(jsonb) from public, anon;
grant execute on function public.record_box(jsonb) to authenticated, service_role;

delete from public.packing_conflicts where kind in ('over-packed', 'pallet-tag');
alter table public.packing_conflicts drop constraint packing_conflicts_kind_check;
alter table public.packing_conflicts add constraint packing_conflicts_kind_check
  check (kind in ('duplicate-box', 'order-changed', 'order-gone', 'lot-differs', 'gtin-differs'));

delete from public.packing_weights where order_id is null;
alter table public.packing_weights
  drop constraint if exists packing_weights_order_or_week,
  drop column if exists week_id,
  drop column if exists box_type_id,
  drop column if exists route,
  drop column if exists suggested_order_id,
  alter column order_id set not null;

alter table public.box_types drop column if exists length_in, drop column if exists width_in,
  drop column if exists height_in, drop column if exists max_weight_lb;

drop table if exists public.pallet_plan_lines;
drop table if exists public.pallet_shipments;
drop table if exists public.shipments;

-- Pallets made since need a ship date and number again.
delete from public.pallets where ship_date is null or number is null;
drop index if exists public.pallets_week_tag_idx;
alter table public.pallets
  drop column if exists tag, drop column if exists status, drop column if exists length_in,
  drop column if exists width_in, drop column if exists max_height_in, drop column if exists max_weight_lb,
  alter column ship_date set not null,
  alter column number set not null;

alter table public.customers drop column if exists ships_to_point_id;
drop table if exists public.consolidation_points;

delete from supabase_migrations.schema_migrations where version = '20261026000200';

commit;
