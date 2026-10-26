-- Scan-to-pallet routing (change request 10/26/26). Boxes come off Mohawk's
-- roller grouped by size, not by customer: Chris scans a box, the app
-- suggests who it's for and which pallet it goes on, he taps to confirm and
-- carries it there. Some customers ship direct; PCC stores all ship together
-- to a distributor, who breaks the pallets down and sends boxes on to each
-- store. A later planner will plan pallets from box sizes; this sets up
-- everything it needs without building it.
--
-- 1. consolidation_points: distributors, set up in Setup. One to start, "PCC
--    distributor" (the real name isn't known yet; nothing keys off the name).
-- 2. customers.ships_to_point_id: Ships to. Null is Direct. Every PCC
--    location starts at the PCC distributor.
-- 3. shipments: a ship-to (a customer location if Direct, else a distributor)
--    for a week, with a ship date (blank for now; Lucas, 10/26/26). Made when
--    the first pallet starts.
-- 4. pallets: a tag Chris types ("P3") and a status (planned, open, full,
--    shipped), plus blank size limits. pallet_shipments links pallets to
--    shipments, so a shipment can have more than one pallet and the planner
--    could combine shipments. "Pallet X of Y" numbers are no longer used.
-- 5. pallet_plan_lines: the planner's boxes per pallet (empty for now). Scanned
--    boxes stay in packing_weights, so plan and actual can be compared.
-- 6. box_types: blank length, width, height, max weight (the 45 lb cap stays).
-- 7. packing_weights: box type, how the box was routed (the suggestion, a
--    runner-up, picked by hand, or locked to a customer), what was suggested,
--    and unassigned boxes: no order (nothing open needed it), just the week,
--    for Kathy to sort out later (Lucas, 10/26/26).
-- 8. start_pallet() and record_box(): offline-safe (safe to send twice). Two
--    phones over-packing, or using the same tag, are saved and flagged for
--    review, never refused.
-- Pallet groups are replaced by Ships to; their table and columns stay until
-- a cleanup migration, so the app keeps working between this and the deploy.
-- Nothing here changes orders or order lines.
-- Undo: supabase/rollback/20261026000200_revert.sql

-- 1. Distributors --------------------------------------------------------------------
create table public.consolidation_points (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.consolidation_points is 'Distributors that take a shipment and send boxes on to each store (PCC). Customers with ships_to_point_id ship here.';
create trigger consolidation_points_updated_at before update on public.consolidation_points
  for each row execute function public.set_updated_at();
create trigger consolidation_points_audit after insert or update or delete on public.consolidation_points
  for each row execute function public.audit_row();
alter table public.consolidation_points enable row level security;
create policy "consolidation_points: read" on public.consolidation_points for select to authenticated
  using ((select public.can_view_any(array['customers', 'calls', 'orders', 'week', 'cutsheet', 'packing', 'downloads'])));
create policy "consolidation_points: change" on public.consolidation_points for all to authenticated
  using ((select public.can_change('customers'))) with check ((select public.can_change('customers')));
revoke all on public.consolidation_points from anon;
grant select, insert, update, delete on public.consolidation_points to authenticated;

-- 2. Ships to --------------------------------------------------------------------------
alter table public.customers
  add column ships_to_point_id uuid references public.consolidation_points (id) on delete set null;
comment on column public.customers.ships_to_point_id is 'Ships to: a distributor, or null for Direct (the location gets its own shipment).';

insert into public.consolidation_points (name, note)
values ('PCC distributor', 'Takes every PCC store''s boxes and sends them on to each store. Rename it when the real name is known.');
update public.customers c
set ships_to_point_id = (select id from public.consolidation_points where name = 'PCC distributor')
where c.parent_customer_id in (select id from public.customers where parent_customer_id is null and name = 'PCC');

-- 3. Shipments -------------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete cascade,
  ship_to_customer_id uuid references public.customers (id) on delete cascade,
  ship_to_point_id uuid references public.consolidation_points (id) on delete cascade,
  -- Blank for now (Lucas, 10/26/26); the suggestion goes soonest ship date first once it's set.
  ship_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint shipments_one_ship_to check ((ship_to_customer_id is null) <> (ship_to_point_id is null))
);
comment on table public.shipments is 'One ship-to for a week: a customer location shipping direct, or a distributor. Pallets link to it through pallet_shipments.';
create unique index shipments_customer_uq on public.shipments (week_id, ship_to_customer_id, coalesce(ship_date, 'infinity'::date))
  where ship_to_customer_id is not null;
create unique index shipments_point_uq on public.shipments (week_id, ship_to_point_id, coalesce(ship_date, 'infinity'::date))
  where ship_to_point_id is not null;
create trigger shipments_updated_at before update on public.shipments for each row execute function public.set_updated_at();
create trigger shipments_audit after insert or update or delete on public.shipments for each row execute function public.audit_row();

-- 4. Pallets: tags and status ------------------------------------------------------------
alter table public.pallets
  alter column ship_date drop not null,
  alter column number drop not null,
  add column tag text not null default '',
  add column status text not null default 'open' check (status in ('planned', 'open', 'full', 'shipped')),
  -- Blank until known; for the planner.
  add column length_in numeric check (length_in is null or length_in > 0),
  add column width_in numeric check (width_in is null or width_in > 0),
  add column max_height_in numeric check (max_height_in is null or max_height_in > 0),
  add column max_weight_lb numeric check (max_weight_lb is null or max_weight_lb > 0);
comment on column public.pallets.tag is 'What Chris writes on the pallet ("P3"). Two pallets with the same tag in a week are flagged, not refused.';
create index pallets_week_tag_idx on public.pallets (week_id, upper(btrim(tag)));

create table public.pallet_shipments (
  pallet_id uuid not null references public.pallets (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pallet_id, shipment_id)
);
create index pallet_shipments_shipment_idx on public.pallet_shipments (shipment_id);
create trigger pallet_shipments_audit after insert or update or delete on public.pallet_shipments
  for each row execute function public.audit_row();

-- 5. Plan lines (empty until the planner) -------------------------------------------------
create table public.pallet_plan_lines (
  id uuid primary key default gen_random_uuid(),
  pallet_id uuid not null references public.pallets (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  box_type_id text references public.box_types (id) on delete set null,
  planned_boxes int not null check (planned_boxes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.pallet_plan_lines is 'Boxes the planner puts on a pallet. Never overwritten with actuals: scanned boxes are in packing_weights.';
create index pallet_plan_lines_pallet_idx on public.pallet_plan_lines (pallet_id);
create trigger pallet_plan_lines_updated_at before update on public.pallet_plan_lines for each row execute function public.set_updated_at();
create trigger pallet_plan_lines_audit after insert or update or delete on public.pallet_plan_lines
  for each row execute function public.audit_row();

alter table public.shipments enable row level security;
alter table public.pallet_shipments enable row level security;
alter table public.pallet_plan_lines enable row level security;
create policy "shipments: read" on public.shipments for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "shipments: change" on public.shipments for all to authenticated
  using ((select public.can_change('packing') or public.can_change('week')))
  with check ((select public.can_change('packing') or public.can_change('week')));
create policy "pallet_shipments: read" on public.pallet_shipments for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "pallet_shipments: change" on public.pallet_shipments for all to authenticated
  using ((select public.can_change('packing') or public.can_change('week')))
  with check ((select public.can_change('packing') or public.can_change('week')));
create policy "pallet_plan_lines: read" on public.pallet_plan_lines for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "pallet_plan_lines: change" on public.pallet_plan_lines for all to authenticated
  using ((select public.can_change('packing') or public.can_change('week')))
  with check ((select public.can_change('packing') or public.can_change('week')));
revoke all on public.shipments, public.pallet_shipments, public.pallet_plan_lines from anon;
grant select, insert, update, delete on public.shipments, public.pallet_shipments, public.pallet_plan_lines to authenticated;

-- 6. Box sizes (blank until known) ---------------------------------------------------------
alter table public.box_types
  add column length_in numeric check (length_in is null or length_in > 0),
  add column width_in numeric check (width_in is null or width_in > 0),
  add column height_in numeric check (height_in is null or height_in > 0),
  add column max_weight_lb numeric check (max_weight_lb is null or max_weight_lb > 0);

-- 7. Boxes: box type, routing, unassigned ---------------------------------------------------
alter table public.packing_weights
  alter column order_id drop not null,
  add column week_id date references public.weeks (id) on delete cascade,
  add column box_type_id text references public.box_types (id) on delete set null,
  add column route text check (route is null or route in ('suggested', 'other', 'picked', 'locked', 'unassigned')),
  add column suggested_order_id uuid references public.orders (id) on delete set null,
  add constraint packing_weights_order_or_week check (order_id is not null or week_id is not null);
comment on column public.packing_weights.week_id is 'Set only for an unassigned box (no order): the week it was packed in.';
comment on column public.packing_weights.route is 'How the customer was chosen: the suggestion, a runner-up (other), picked by hand, locked to a customer, or unassigned.';
comment on column public.packing_weights.suggested_order_id is 'The order the app suggested, when the packer chose another.';
create index packing_weights_week_idx on public.packing_weights (week_id) where week_id is not null;

alter table public.packing_conflicts drop constraint packing_conflicts_kind_check;
alter table public.packing_conflicts add constraint packing_conflicts_kind_check
  check (kind in ('duplicate-box', 'order-changed', 'order-gone', 'lot-differs', 'gtin-differs', 'over-packed', 'pallet-tag'));

-- 8. Starting a pallet ------------------------------------------------------------------------
-- Called from the phone, now or when it's back in range. Safe to send twice
-- (the pallet id is made on the phone). Finds or makes the shipment.
create or replace function public.start_pallet(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_week date := (p ->> 'week_id')::date;
  v_tag text := btrim(coalesce(p ->> 'tag', ''));
  v_customer uuid := nullif(p ->> 'ship_to_customer_id', '')::uuid;
  v_point uuid := nullif(p ->> 'ship_to_point_id', '')::uuid;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'open');
  v_shipment uuid;
begin
  if not (public.can_change('packing') or public.can_change('week')) then
    raise exception 'You don''t have permission to start a pallet.' using errcode = '42501';
  end if;
  if v_id is null or v_week is null or v_tag = '' then
    raise exception 'A pallet needs an id, a week and a tag.' using errcode = '22023';
  end if;
  if (v_customer is null) = (v_point is null) then
    raise exception 'A pallet ships to one customer or one distributor.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pallets where id = v_id) then
    return jsonb_build_object('status', 'already', 'id', v_id);
  end if;

  if v_customer is not null then
    select id into v_shipment from public.shipments
    where week_id = v_week and ship_to_customer_id = v_customer and ship_date is null;
    if v_shipment is null then
      insert into public.shipments (week_id, ship_to_customer_id) values (v_week, v_customer)
      on conflict do nothing returning id into v_shipment;
      if v_shipment is null then
        select id into v_shipment from public.shipments
        where week_id = v_week and ship_to_customer_id = v_customer and ship_date is null;
      end if;
    end if;
  else
    select id into v_shipment from public.shipments
    where week_id = v_week and ship_to_point_id = v_point and ship_date is null;
    if v_shipment is null then
      insert into public.shipments (week_id, ship_to_point_id) values (v_week, v_point)
      on conflict do nothing returning id into v_shipment;
      if v_shipment is null then
        select id into v_shipment from public.shipments
        where week_id = v_week and ship_to_point_id = v_point and ship_date is null;
      end if;
    end if;
  end if;

  -- Another pallet this week with the same tag (two phones, offline): saved, and flagged.
  if exists (select 1 from public.pallets where week_id = v_week and upper(btrim(tag)) = upper(v_tag)) then
    insert into public.packing_conflicts (kind, message, details)
    values ('pallet-tag', format('Two pallets this week are tagged %s. Check which boxes are on which.', v_tag), p);
  end if;

  insert into public.pallets (id, week_id, tag, status) values (v_id, v_week, v_tag, v_status);
  insert into public.pallet_shipments (pallet_id, shipment_id) values (v_id, v_shipment);
  return jsonb_build_object('status', 'saved', 'id', v_id, 'shipment_id', v_shipment);
end;
$$;
revoke all on function public.start_pallet(jsonb) from public, anon;
grant execute on function public.start_pallet(jsonb) to authenticated, service_role;

-- record_box(): also the box type, how it was routed, and unassigned boxes.
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
    pallet_id, raw_scan, photo_path, client_id, scanned_at, off_order
  ) values (
    v_order, case when v_order is null then v_week end, v_box_type, v_route, v_suggested, v_product, (p ->> 'weight')::numeric, v_box, v_slot, v_label, v_source, v_gtin, v_serial,
    nullif(p ->> 'serial_date', '')::date, nullif(p ->> 'case_no', ''), v_pack, v_lot,
    v_pallet, nullif(p ->> 'raw_scan', ''), nullif(p ->> 'photo_path', ''),
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


-- Live updates on other phones --------------------------------------------------------------
alter publication supabase_realtime add table public.shipments, public.pallet_shipments, public.pallet_plan_lines, public.consolidation_points;
