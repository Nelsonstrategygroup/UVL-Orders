-- Scanning stage 2 (SPEC 11): the data behind scanning Mohawk's box labels.
-- Revert: supabase/rollback/20261019000100_revert.sql
--
-- - Products: Mohawk item number and a normal box weight range (blank to start).
-- - gtin_products: which product a label's GTIN is. Never worked out from the GTIN.
-- - lots: the lot printed on the label (not in the barcode), remembered per
--   GTIN + pack date so later boxes fill it in.
-- - pallets: the pallets in a shipment ("Pallet 1 of 2").
-- - packing_weights: a box's label details. Existing weights (from the weigh
--   panel) keep working; scans and hand-entered labels add the details.
-- - packing_conflicts: what the server found when phones uploaded (the same
--   box twice, an order that changed), for Kathy. Never overwritten.
-- - record_box(): how a scan is saved. Safe to send twice.
-- - A private bucket for photos of unreadable labels.
-- Nothing here changes orders or order lines.

-- Products ---------------------------------------------------------------------
alter table public.products
  add column mohawk_item_no text not null default '',
  add column box_lb_min numeric check (box_lb_min is null or box_lb_min > 0),
  add column box_lb_max numeric check (box_lb_max is null or box_lb_max > 0),
  add constraint products_box_range check (box_lb_min is null or box_lb_max is null or box_lb_min <= box_lb_max);
comment on column public.products.mohawk_item_no is 'Mohawk''s item number (3111, 3083, ...). Not in the barcode.';
comment on column public.products.box_lb_min is 'Normal box weight, low end. Blank: no warning. A box outside the range is warned about, never blocked.';

-- GTIN to product ----------------------------------------------------------------
create table public.gtin_products (
  gtin text primary key check (gtin ~ '^[0-9]{14}$'),
  product_id text not null references public.products (id) on delete restrict,
  note text not null default '',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.gtin_products is 'Which product a box label''s GTIN is. GTINs use different company prefixes; never derive the product from the GTIN. Admins teach new ones.';
create index gtin_products_product_idx on public.gtin_products (product_id);
create trigger gtin_products_updated_at before update on public.gtin_products
  for each row execute function public.set_updated_at();
create trigger gtin_products_audit after insert or update or delete on public.gtin_products
  for each row execute function public.audit_row();

alter table public.gtin_products enable row level security;
create policy "gtin_products: read" on public.gtin_products for select to authenticated
  using ((select public.can_view_any(array['packing', 'setup', 'freezer'])));
create policy "gtin_products: change" on public.gtin_products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.gtin_products from anon;
grant select, insert, update, delete on public.gtin_products to authenticated;

-- Lots -----------------------------------------------------------------------------
create table public.lots (
  id uuid primary key default gen_random_uuid(),
  gtin text not null check (gtin ~ '^[0-9]{14}$'),
  pack_date date not null,
  lot text not null check (btrim(lot) <> '' and length(lot) <= 20),
  -- Room for ranch-level tracing later (which lambs or ranch a lot came from).
  source_note text not null default '',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (gtin, pack_date)
);
comment on table public.lots is 'The Mohawk lot printed on a label (it is not in the barcode), by GTIN + pack date, so later boxes fill it in. Traceability starts here.';
create trigger lots_updated_at before update on public.lots
  for each row execute function public.set_updated_at();
create trigger lots_audit after insert or update or delete on public.lots
  for each row execute function public.audit_row();

alter table public.lots enable row level security;
create policy "lots: read" on public.lots for select to authenticated
  using ((select public.can_view_any(array['packing', 'setup', 'freezer', 'downloads'])));
-- A packer records a lot the first time it is seen; only an admin changes one.
create policy "lots: add" on public.lots for insert to authenticated
  with check ((select public.can_change('packing')));
create policy "lots: change" on public.lots for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "lots: delete" on public.lots for delete to authenticated
  using ((select public.is_admin()));
revoke all on public.lots from anon;
grant select, insert, update, delete on public.lots to authenticated;

-- Pallets ------------------------------------------------------------------------
create table public.pallets (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete cascade,
  ship_date date not null,
  -- X in "Pallet X of Y"; Y is how many pallets ship that day, all customers together.
  number int not null check (number >= 1),
  pallet_group_id uuid references public.pallet_groups (id) on delete set null,
  label text not null default '',
  note text not null default '',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (ship_date, number)
);
comment on table public.pallets is 'The pallets in a shipment. "Pallet X of Y": Y counts every pallet shipping that day. A chain''s stores can fill more than one pallet.';
create index pallets_week_idx on public.pallets (week_id);
create trigger pallets_updated_at before update on public.pallets
  for each row execute function public.set_updated_at();
create trigger pallets_audit after insert or update or delete on public.pallets
  for each row execute function public.audit_row();

alter table public.pallets enable row level security;
create policy "pallets: read" on public.pallets for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "pallets: change" on public.pallets for all to authenticated
  using ((select public.can_change('packing'))) with check ((select public.can_change('packing')));
revoke all on public.pallets from anon;
grant select, insert, update, delete on public.pallets to authenticated;

-- Boxes: label details on packing_weights ---------------------------------------
alter table public.packing_weights
  add column source text not null default 'weigh' check (source in ('weigh', 'scan', 'manual')),
  add column gtin text check (gtin is null or gtin ~ '^[0-9]{14}$'),
  add column serial text,
  add column serial_date date,
  add column case_no text,
  add column pack_date date,
  add column lot text,
  add column pallet_id uuid references public.pallets (id) on delete set null,
  add column raw_scan text,
  add column photo_path text,
  -- Made on the phone, so an upload sent twice is saved once.
  add column client_id uuid unique,
  add column scanned_at timestamptz,
  -- The packer saw "not on this order" and assigned it anyway.
  add column off_order boolean not null default false,
  -- Every scanned or hand-entered box has a lot; it is never the scan or pack date.
  add constraint packing_weights_lot check (source = 'weigh' or (lot is not null and btrim(lot) <> '')),
  add constraint packing_weights_scan_has_label check (source <> 'scan' or (gtin is not null and serial is not null));
comment on column public.packing_weights.source is 'weigh: the weigh panel. scan: a box label scanned. manual: a label typed in because it would not scan.';
comment on column public.packing_weights.serial is 'AI 21. GTIN + serial is the box''s unique ID.';
comment on column public.packing_weights.serial_date is 'From Mohawk''s serial (YY + day of year): the day the label printed. Can differ from pack_date.';

-- The same box can't be recorded twice.
create unique index packing_weights_box_idx on public.packing_weights (gtin, serial) where serial is not null;
create index packing_weights_pallet_idx on public.packing_weights (pallet_id);

-- Only an admin changes a box's lot once it is set. The audit log keeps who,
-- when, and the old value.
create or replace function public.guard_box_lot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lot is not null and new.lot is distinct from old.lot and not public.is_admin() then
    raise exception 'Only an admin can change a box''s lot.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger packing_weights_guard_lot before update on public.packing_weights
  for each row execute function public.guard_box_lot();

-- Conflicts for Kathy ----------------------------------------------------------------
create table public.packing_conflicts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('duplicate-box', 'order-changed', 'order-gone', 'lot-differs', 'gtin-differs')),
  message text not null,
  order_id uuid references public.orders (id) on delete set null,
  product_id text references public.products (id) on delete set null,
  gtin text,
  serial text,
  client_id uuid,
  -- The upload as the phone sent it, so nothing is lost.
  details jsonb not null default '{}',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolution text not null default '',
  updated_at timestamptz
);
comment on table public.packing_conflicts is 'What the server found when scans uploaded. Flagged for Kathy; nothing is overwritten.';
create index packing_conflicts_open_idx on public.packing_conflicts (created_at) where resolved_at is null;
create trigger packing_conflicts_updated_at before update on public.packing_conflicts
  for each row execute function public.set_updated_at();
create trigger packing_conflicts_audit after insert or update or delete on public.packing_conflicts
  for each row execute function public.audit_row();

alter table public.packing_conflicts enable row level security;
create policy "packing_conflicts: read" on public.packing_conflicts for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week'])));
create policy "packing_conflicts: add" on public.packing_conflicts for insert to authenticated
  with check ((select public.can_change('packing')));
create policy "packing_conflicts: resolve" on public.packing_conflicts for update to authenticated
  using ((select public.can_change('orders') or public.is_admin()))
  with check ((select public.can_change('orders') or public.is_admin()));
revoke all on public.packing_conflicts from anon;
grant select, insert, update on public.packing_conflicts to authenticated;

-- record_box(): save one box ------------------------------------------------------
-- Called for every scan or hand-entered label, now or when a phone comes back
-- online. Runs as the caller, so the policies above apply.
--   saved      the box is recorded
--   already    this upload (client_id) was saved before; nothing changed
--   duplicate  this box (GTIN + serial) is already recorded; flagged, not saved
--   gone       the order no longer exists; flagged, not saved
-- An order that changed (the product is no longer on it) is saved and flagged.
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
    order_id, product_id, weight, box_no, source, gtin, serial, serial_date, case_no, pack_date, lot,
    pallet_id, raw_scan, photo_path, client_id, scanned_at, off_order
  ) values (
    v_order, v_product, (p ->> 'weight')::numeric, v_box, v_source, v_gtin, v_serial,
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

-- Live updates on other phones and screens -------------------------------------
-- (packing_weights was missing, so weights only showed elsewhere after a reload.)
alter table public.packing_weights replica identity full;
alter table public.pallets replica identity full;
alter table public.packing_conflicts replica identity full;
alter publication supabase_realtime add table public.packing_weights, public.pallets, public.packing_conflicts;

-- Photos of labels that wouldn't scan ------------------------------------------------
-- Private bucket; packers add, anyone who can see Packing can look. Skipped
-- where Supabase Storage isn't installed (the test database).
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('box-photos', 'box-photos', false, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
  on conflict (id) do nothing;
  execute $p$
    create policy "box-photos: read" on storage.objects for select to authenticated
      using (bucket_id = 'box-photos' and (select public.can_view_any(array['packing', 'orders', 'week'])))
  $p$;
  execute $p$
    create policy "box-photos: add" on storage.objects for insert to authenticated
      with check (bucket_id = 'box-photos' and (select public.can_change('packing')))
  $p$;
  execute $p$
    create policy "box-photos: delete" on storage.objects for delete to authenticated
      using (bucket_id = 'box-photos' and (select public.is_admin()))
  $p$;
end $$;
