-- Quieter change log for drafts made from packing (Lucas, 11/15/26). A draft's
-- lines are a copy of packing, and every box and count is in the change log
-- already, so when packing refreshes a draft automatically
-- (draft_for_location(), 20261115000200) that refresh isn't logged: its line
-- rewrites, and the draft's own automatic number and fingerprint updates.
--
-- Still logged: a draft made or removed by packing (source "Draft made from
-- packing" / "Draft removed: nothing packed"), everything a person does to an
-- invoice, opening the week on Invoices, and finalizing, reopening, voiding.
--
-- Changes: the invoices and invoice_lines audit triggers get a WHEN that skips
-- a row only while uvl.skip_draft_audit is on, which only draft_for_location()
-- sets, around its refresh. Nothing else changes.
--
-- Undo: supabase/rollback/20261115000300_revert.sql

drop trigger invoices_audit on public.invoices;
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row
  when (coalesce(current_setting('uvl.skip_draft_audit', true), '') <> 'on')
  execute function public.audit_row();

drop trigger invoice_lines_audit on public.invoice_lines;
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row
  when (coalesce(current_setting('uvl.skip_draft_audit', true), '') <> 'on')
  execute function public.audit_row();

create or replace function public.draft_for_location(p_week date, p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_gone int;
  v_src text := current_setting('uvl.source', true);
begin
  -- One at a time per week, as sync_invoice_drafts().
  perform pg_advisory_xact_lock(hashtext('invoices:' || p_week::text));

  if public.location_packed(p_week, p_customer)
    and not exists (select 1 from public.invoices where week_id = p_week and customer_id = p_customer) then
    perform set_config('uvl.source', 'Draft made from packing', true);
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, p_customer, p_week + 1, auth.uid());
    perform set_config('uvl.source', coalesce(v_src, ''), true);
  end if;

  select id into v_id from public.invoices
  where week_id = p_week and customer_id = p_customer and status = 'draft';
  if v_id is null then
    return;
  end if;

  if not public.location_packed(p_week, p_customer) then
    perform set_config('uvl.source', 'Draft removed: nothing packed', true);
    delete from public.invoices i
    where i.id = v_id
      and btrim(i.memo) = ''
      and not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.kind = 'manual');
    get diagnostics v_gone = row_count;
    perform set_config('uvl.source', coalesce(v_src, ''), true);
    if v_gone > 0 then
      return;
    end if;
  end if;

  -- The refresh itself: a copy of packing, not logged.
  perform set_config('uvl.skip_draft_audit', 'on', true);
  perform public.sync_invoice_draft(v_id);
  perform set_config('uvl.skip_draft_audit', '', true);
exception when others then
  perform set_config('uvl.skip_draft_audit', '', true);
  raise;
end;
$$;
revoke execute on function public.draft_for_location(date, uuid) from public, anon, authenticated;
grant execute on function public.draft_for_location(date, uuid) to service_role;
