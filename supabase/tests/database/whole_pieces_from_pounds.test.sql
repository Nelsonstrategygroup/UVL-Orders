-- Pieces are whole (Lucas, 11/7/26): pounds of a piece product become whole
-- pieces, to the nearest, at least 1; pieces into pounds stay exact.

begin;
select plan(5);

select is(public.qty_in_product_unit(20, 'lb', 'each', 4.5), 4::numeric, '20 lb of 4.5 lb shoulders is 4');
select is(public.qty_in_product_unit(120, 'lb', 'each', 4.5), 27::numeric, '120 lb is 27');
select is(public.qty_in_product_unit(1, 'lb', 'each', 4.5), 1::numeric, 'under one piece is 1');
select is(public.qty_in_product_unit(20, 'lb', 'each', null), 0::numeric, 'no piece weight: 0');
select is(public.qty_in_product_unit(3, 'each', 'lb', 4.5), 13.5::numeric, 'pieces into pounds stay exact');

select * from finish();
rollback;
