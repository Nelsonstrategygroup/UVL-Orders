-- Undo 20261029000100_invoice_drafts.sql: removes invoices, their lines, and
-- the functions that make drafts. Box records, orders and prices are not
-- touched.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261029000100_revert.sql

begin;
alter publication supabase_realtime drop table public.invoices, public.invoice_lines;
drop function if exists public.update_invoice_draft(uuid);
drop function if exists public.make_invoice_drafts(date);
drop function if exists public.refill_invoice_lines(uuid);
drop function if exists public.invoice_number_for(date, uuid, int);
drop function if exists public.invoice_fingerprints(date);
drop function if exists public.invoice_fingerprint(date, uuid);
drop function if exists public.invoice_lines_from_packing(date, uuid);
drop table if exists public.invoice_lines;
drop function if exists public.invoice_lines_draft_only();
drop table if exists public.invoices;
delete from supabase_migrations.schema_migrations where version = '20261029000100';
commit;
