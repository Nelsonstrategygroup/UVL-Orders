-- Undo 20261115000300_draft_audit_quiet.sql: every automatic draft refresh
-- from packing is logged again, and draft_for_location() goes back to
-- 20261115000200.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261115000300_revert.sql

begin;
drop trigger invoices_audit on public.invoices;
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.audit_row();
drop trigger invoice_lines_audit on public.invoice_lines;
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function public.audit_row();
create or replace function public.draft_for_location(p_week date, p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- One at a time per week, as sync_invoice_drafts().
  perform pg_advisory_xact_lock(hashtext('invoices:' || p_week::text));

  if public.location_packed(p_week, p_customer)
    and not exists (select 1 from public.invoices where week_id = p_week and customer_id = p_customer) then
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, p_customer, p_week + 1, auth.uid());
  end if;

  select id into v_id from public.invoices
  where week_id = p_week and customer_id = p_customer and status = 'draft';
  if v_id is null then
    return;
  end if;

  if not public.location_packed(p_week, p_customer) then
    delete from public.invoices i
    where i.id = v_id
      and btrim(i.memo) = ''
      and not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.kind = 'manual');
    if not found then
      perform public.sync_invoice_draft(v_id);
    end if;
    return;
  end if;
  perform public.sync_invoice_draft(v_id);
end;
$$;
revoke execute on function public.draft_for_location(date, uuid) from public, anon, authenticated;
grant execute on function public.draft_for_location(date, uuid) to service_role;
delete from supabase_migrations.schema_migrations where version = '20261115000300';
commit;
