-- Undo 20261019000100_scanning_data.sql (scanning stage 2).
-- Run with: npx supabase db query --linked -f supabase/rollback/20261019000100_revert.sql
-- Removes every scanned box's label details (GTIN, serial, lot, pallet) and
-- the GTIN map, lots, pallets and conflicts. Weights from the weigh panel stay.
-- Back up first if any real scans exist:
--   select * from packing_weights where source <> 'weigh';
-- Never touches orders or order lines.

begin;

-- Photos bucket and its policies (only where Storage exists).
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  drop policy if exists "box-photos: read" on storage.objects;
  drop policy if exists "box-photos: add" on storage.objects;
  drop policy if exists "box-photos: delete" on storage.objects;
  delete from storage.objects where bucket_id = 'box-photos';
  delete from storage.buckets where id = 'box-photos';
end $$;

alter publication supabase_realtime drop table public.packing_weights, public.pallets, public.packing_conflicts;
alter table public.packing_weights replica identity default;

drop function if exists public.record_box(jsonb);
drop table if exists public.packing_conflicts;

drop trigger if exists packing_weights_guard_lot on public.packing_weights;
drop function if exists public.guard_box_lot();
drop index if exists public.packing_weights_box_idx;
drop index if exists public.packing_weights_pallet_idx;
-- Scanned and hand-entered boxes go (they can't exist without their label details).
delete from public.packing_weights where source <> 'weigh';
alter table public.packing_weights
  drop constraint if exists packing_weights_lot,
  drop constraint if exists packing_weights_scan_has_label,
  drop column if exists source,
  drop column if exists gtin,
  drop column if exists serial,
  drop column if exists serial_date,
  drop column if exists case_no,
  drop column if exists pack_date,
  drop column if exists lot,
  drop column if exists pallet_id,
  drop column if exists raw_scan,
  drop column if exists photo_path,
  drop column if exists client_id,
  drop column if exists scanned_at,
  drop column if exists off_order;

drop table if exists public.pallets;
drop table if exists public.lots;
drop table if exists public.gtin_products;

alter table public.products
  drop constraint if exists products_box_range,
  drop column if exists mohawk_item_no,
  drop column if exists box_lb_min,
  drop column if exists box_lb_max;

delete from supabase_migrations.schema_migrations where version = '20261019000100';

commit;
