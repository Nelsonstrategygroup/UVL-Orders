-- Data fix (Lucas, 10/26/26): three boxes packed on Mon Oct 26 were recorded
-- for a different store than the label on the box. Each moves to the store
-- on its label, into that store's labelled box and planned pallet. The audit
-- log keeps the old and new order, pallet and box for each, recorded as
-- Lucas (who approved the fix).
--
-- - BNLS Loins 15.45 lb, serial 2629910062: #15 Columbia (P1) -> #18 Ballard,
--   label 22, P2.
-- - Necks 11.30 lb, serial 2629910081: #11 Fremont (P1) -> #20 Bellevue,
--   label 161, P2. The 11.30 lb neck weight typed in for Bellevue on Packing
--   at 2:11 PM was this same box (Lucas), so it's removed.
-- - Jalapeno Honey Pepper Sticks 10.00 lb, serial 2628720010: Key City (not on
--   its order) -> #12 Redmond, label 167, stays on P3.
--
-- Each change only happens if the box is still where it was on 10/26, so
-- running this twice, or after someone fixed it by hand, changes nothing.
-- Nothing changes orders or order lines.
-- Undo: supabase/rollback/20261026000600_revert.sql

-- Record the changes as Lucas in the audit log.
select set_config('request.jwt.claims', '{"sub":"7182190a-5556-4e1d-a4dd-27ac78db6393","role":"authenticated"}', true);

update public.packing_weights
set order_id = 'fcdd092e-2564-40ba-86c8-7e3954d25fd5', pallet_id = '7de8bf31-2864-4e85-b471-b0b021ff58a6',
    slot = 1, label_no = 22, route = 'picked', off_order = false
where id = '0fc55aa9-f8ae-4350-9bb9-890b50782628' and order_id = 'ccca8ba6-5729-4294-ad16-f7178cf447e6';

delete from public.packing_weights
where id = '603eda59-04a9-4902-b78a-0a03c1854018' and serial is null and weight = 11.3
  and order_id = '69c85bec-ccf4-4d25-9aa5-5a6a761e51d1';

update public.packing_weights
set order_id = '69c85bec-ccf4-4d25-9aa5-5a6a761e51d1', pallet_id = '7de8bf31-2864-4e85-b471-b0b021ff58a6',
    slot = 1, label_no = 161, route = 'picked', off_order = false
where id = 'd78bd731-4485-4608-bb05-bc7a50371cce' and order_id = 'b34e53e4-d84d-4cb4-a9ba-a9e278168df8';

update public.packing_weights
set order_id = '68557a2f-c984-4ebb-91d9-01679b741fcd', pallet_id = 'ad935f5d-6711-4cb2-b50c-b60f7a6f7485',
    slot = 1, label_no = 167, route = 'picked', off_order = false
where id = 'b6bdddfe-d20b-46f6-82b9-4d78d623da55' and order_id = '5cd348e5-2c29-4e98-938a-462a5ee0c598';

select set_config('request.jwt.claims', '', true);
