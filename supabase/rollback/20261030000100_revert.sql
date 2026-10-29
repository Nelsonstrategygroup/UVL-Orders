-- Undo 20261030000100_invoice_lifecycle.sql: removes payments, the boxes kept
-- on finalized invoices, and finalize, sent, void and reissue. Finalized,
-- sent and void invoices go back to drafts (their lines keep the prices that
-- were copied onto them). Box records, orders and prices are not touched.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261030000100_revert.sql

begin;
alter publication supabase_realtime drop table public.payments;
drop function if exists public.reissue_invoice(uuid);
drop function if exists public.void_invoice(uuid, text);
drop function if exists public.mark_invoice_sent(uuid, boolean);
drop function if exists public.finalize_invoice(uuid);
drop table if exists public.payments;
drop function if exists public.payments_finalized_only();
drop table if exists public.invoice_boxes;
drop trigger if exists invoices_guard on public.invoices;
drop function if exists public.invoices_guard();
drop function if exists public.invoice_line_total(text, numeric, numeric, text, numeric);
drop function if exists public.price_on(text, uuid, date);
-- Back to drafts; a reissue and the one it replaced can't both be live, so the void ones go.
delete from public.invoices i where i.status = 'void'
  and exists (select 1 from public.invoices r where r.replaces_id = i.id);
update public.invoices set status = 'draft' where status <> 'draft';
alter table public.invoices
  drop column if exists replaces_id,
  drop column if exists terms_days,
  drop column if exists due_date,
  drop column if exists total,
  drop column if exists issued,
  drop column if exists finalized_at,
  drop column if exists finalized_by,
  drop column if exists sent_at,
  drop column if exists sent_by,
  drop column if exists voided_at,
  drop column if exists voided_by,
  drop column if exists void_reason;
delete from supabase_migrations.schema_migrations where version = '20261030000100';
commit;
