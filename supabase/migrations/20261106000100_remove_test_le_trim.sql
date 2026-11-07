-- Remove the leftover test customer "TEST Le Trim" (Lucas, 11/6/26). It was
-- made for the Le Trim screen test and showed on every week's Orders list.
-- Its only record is one test order on the far-future 3/1/2027 week (22 BI
-- Legs, 10 BNLS Shoulder, 120 lb Le Trim): no boxes, pallets, invoices,
-- contacts or history. The 3/1/2027 test week's lamb override (14) is cleared
-- too. Matched by id AND name, so nothing else can be touched.
-- Undo: supabase/rollback/20261106000100_revert.sql

delete from public.order_lines
where order_id in (
  select o.id from public.orders o
  join public.customers c on c.id = o.customer_id
  where c.id = '4d3e2dc5-87d0-4358-8104-9264b76b075f' and c.name = 'TEST Le Trim'
    and o.week_id = '2027-03-01'
);

delete from public.orders o
using public.customers c
where c.id = o.customer_id
  and c.id = '4d3e2dc5-87d0-4358-8104-9264b76b075f' and c.name = 'TEST Le Trim'
  and o.week_id = '2027-03-01';

delete from public.customers
where id = '4d3e2dc5-87d0-4358-8104-9264b76b075f' and name = 'TEST Le Trim'
  and not exists (select 1 from public.orders o where o.customer_id = '4d3e2dc5-87d0-4358-8104-9264b76b075f');

update public.weeks set lamb_override = null
where id = '2027-03-01' and lamb_override = 14;
