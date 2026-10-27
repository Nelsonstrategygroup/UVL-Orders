-- Data fix (Lucas, 10/26/26, after Chris reviewed the reconciliation of his
-- 10/26 pack sheet against the scans). Each change is logged in the audit log
-- as Lucas, with the old and new values. Each only happens if the box is
-- still as it was, so running this again changes nothing.
--
-- 1. #14 GL Village: Front Shanks 13.10 lb added, typed in (no serial or
--    lot), box 1 (label 47), on P3.
-- 2. #20 Bellevue: Tongue 2.65 lb added, typed in, box 1 (label 165), on P2.
-- 3. #13 Edmonds Racks 21.05 lb (typed in on Packing, so it had no pallet):
--    put on P1. Product and weight unchanged. Logged: "Mohawk labeled as
--    Necks, contents are Racks" (Chris).
-- 4. Key City Ground Lamb 5 lb: the scanned box (serial 2629210182) is the
--    20.10 lb one (Chris): 20.00 -> 20.10. A second box, 20.25 lb, added typed
--    in, box 2, on P3.
-- 5. Key City 19.65 lb box (serial 2629910149): Hind Shanks -> Labeled Hind
--    Shanks (what Key City ordered; the two share Mohawk's barcode), box 1
--    (label 53).
-- Not changed: #18 Ballard shanks (the labels were right; the sheet had the
-- rows swapped), and Emerson BNLS Shoulder 34.22 and the Emerson 35.75 lb box
-- (on hold until Lucas confirms).
-- Nothing changes orders or order lines.
-- Undo: supabase/rollback/20261026000700_revert.sql

select set_config('request.jwt.claims', '{"sub":"7182190a-5556-4e1d-a4dd-27ac78db6393","role":"authenticated"}', true);

-- 1. GL Village Front Shanks.
insert into public.packing_weights (id, order_id, product_id, weight, source, slot, label_no, pallet_id, route)
select 'a1c26000-0000-4000-8000-000000000001', '98f63ba5-16ae-4ed7-ae8c-7bd6e7fab8a4', 'cp-front-shanks', 13.10, 'weigh', 1, 47,
       'ad935f5d-6711-4cb2-b50c-b60f7a6f7485', 'picked'
where not exists (select 1 from public.packing_weights where id = 'a1c26000-0000-4000-8000-000000000001');

-- 2. Bellevue Tongue.
insert into public.packing_weights (id, order_id, product_id, weight, source, slot, label_no, pallet_id, route)
select 'a1c26000-0000-4000-8000-000000000002', '69c85bec-ccf4-4d25-9aa5-5a6a761e51d1', 'b5bbc115-fd31-4dc8-8250-e7451ab3257c', 2.65, 'weigh', 1, 165,
       '7de8bf31-2864-4e85-b471-b0b021ff58a6', 'picked'
where not exists (select 1 from public.packing_weights where id = 'a1c26000-0000-4000-8000-000000000002');

-- 3. Edmonds Racks onto P1, with Chris's note in its log entry.
update public.packing_weights set pallet_id = 'ac9c3282-1e4b-4ed4-9e11-034852bf8b72'
where id = '292cbff2-d222-49c3-880e-663861cbbcfc' and pallet_id is null;
update public.audit_log set new_data = new_data || '{"note": "Mohawk labeled as Necks, contents are Racks"}'::jsonb
where id = (select max(id) from public.audit_log
            where table_name = 'packing_weights' and row_id = '292cbff2-d222-49c3-880e-663861cbbcfc' and action = 'update')
  and (new_data ->> 'pallet_id') = 'ac9c3282-1e4b-4ed4-9e11-034852bf8b72';

-- 4. Key City Ground Lamb: the scanned box is 20.10; a second box at 20.25.
update public.packing_weights set weight = 20.10
where id = 'f660ecb7-a2e9-4eb0-b01e-88c8fe70a157' and weight = 20;
insert into public.packing_weights (id, order_id, product_id, weight, source, slot, pallet_id, route)
select 'a1c26000-0000-4000-8000-000000000003', '5cd348e5-2c29-4e98-938a-462a5ee0c598', 'cp-ground-5', 20.25, 'weigh', 2,
       'ad935f5d-6711-4cb2-b50c-b60f7a6f7485', 'picked'
where not exists (select 1 from public.packing_weights where id = 'a1c26000-0000-4000-8000-000000000003');

-- 5. Key City's 19.65 lb shanks are the Labeled Hind Shanks it ordered.
update public.packing_weights set product_id = 'cp-labeled-hind-shanks', slot = 1, label_no = 53, off_order = false
where id = 'f645ecf1-861d-4b7f-862c-4516bb3f948e' and product_id = 'cp-hind-shanks';

select set_config('request.jwt.claims', '', true);
