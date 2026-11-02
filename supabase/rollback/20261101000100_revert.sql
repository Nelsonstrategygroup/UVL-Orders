-- Undo 20261101000100_weigh_sheet_blanks.sql: the blank settings back to 6
-- and 2, and the invoice numbers back as they were (11/9 none, 12/28 3003,
-- the test week of 3/1/2027 3004).
-- Run with: npx supabase db query --linked -f supabase/rollback/20261101000100_revert.sql

begin;
update public.app_settings set pack_unknown_blanks = 6, pack_spare_blanks = 2;
update public.weeks set invoice_number = null where id = '2026-11-09' and invoice_number = 3003;
update public.weeks set invoice_number = 3003 where id = '2026-12-28' and invoice_number is null;
update public.weeks set invoice_number = 3004 where id = '2027-03-01' and invoice_number is null;
delete from supabase_migrations.schema_migrations where version = '20261101000100';
commit;
