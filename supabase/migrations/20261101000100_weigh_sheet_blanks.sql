-- The Weigh Sheet (Lucas, 11/1/26): a product with no known box count gets 3
-- weight cells, and a product with a known box count gets one spare cell
-- after its planned boxes (they were 6 and 2). Both stay settings in Setup.
--
-- Also the weekly invoice numbers (Lucas, 11/1/26): 11/2 is 3002, so 11/9 is
-- 3003. 3003 and 3004 had been typed on 12/28 and the test week of 3/1/2027
-- by mistake; those are cleared. No invoices exist for any of these weeks.
-- Each change only applies while the number is still the mistaken one.

update public.app_settings set pack_unknown_blanks = 3, pack_spare_blanks = 1;

update public.weeks set invoice_number = null where id = '2026-12-28' and invoice_number = 3003;
update public.weeks set invoice_number = null where id = '2027-03-01' and invoice_number = 3004;

insert into public.weeks (id, invoice_number) values ('2026-11-09', 3003)
on conflict (id) do update set invoice_number = 3003 where public.weeks.invoice_number is null;
