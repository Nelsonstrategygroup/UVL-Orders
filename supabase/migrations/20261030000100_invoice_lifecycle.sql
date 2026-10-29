-- Invoicing stage 3: finalize, sent, void and reissue, payments (SPEC 15,
-- docs/invoicing-plan.md).
--
-- Finalize checks every line has a price and a count, the draft is up to
-- date with packing, and it has a number; then copies the prices onto the
-- lines, the boxes into invoice_boxes, and the name, bill-to, terms and
-- business details onto the invoice, and works out the total (each line
-- rounded half up to the cent, less its discount). After that the lines never
-- change: a correction is Void (with a reason) and Reissue (3001-NEWP-R1),
-- which starts a new draft from packing with the same added lines and
-- discounts. The invoice date and number can still be changed (the due date
-- follows the date; prices stay as issued).
--
-- Sent is a mark (no emailing yet). Payments: ACH, check or other, with a
-- reference; partial payments allowed. Paid and Partly paid come from the
-- payments, not a status.
--
-- Status changes only through these functions. No new foreign key makes a
-- second link between two tables already linked (10/26 outage): payments ->
-- invoices, invoice_boxes -> invoices, invoices -> invoices (replaces).

-- ---------------------------------------------------------------------------
-- What's kept on a finalized invoice.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column replaces_id uuid references public.invoices (id) on delete set null,
  add column terms_days int check (terms_days between 0 and 365),
  add column due_date date,
  add column total numeric(12, 2),
  add column issued jsonb,
  add column finalized_at timestamptz,
  add column finalized_by uuid,
  add column sent_at timestamptz,
  add column sent_by uuid,
  add column voided_at timestamptz,
  add column voided_by uuid,
  add column void_reason text not null default '';
comment on column public.invoices.issued is
  'As issued, from finalizing: customer_name, bill_to, box_detail, and the business details (business_name, business_address, business_phone, business_email, remit_to, invoice_note).';
comment on column public.invoices.total is 'Set when finalized: the sum of the line totals.';
comment on column public.invoices.replaces_id is 'The voided invoice this one reissues.';

-- The price a line gets on a date: the customer's own newest on or before it, else the default's.
create or replace function public.price_on(p_product text, p_customer uuid, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select price from public.prices
      where product_id = p_product and customer_id = p_customer and effective_from <= p_date
      order by effective_from desc limit 1),
    (select price from public.prices
      where product_id = p_product and customer_id is null and effective_from <= p_date
      order by effective_from desc limit 1));
$$;
revoke execute on function public.price_on(text, uuid, date) from public, anon;
grant execute on function public.price_on(text, uuid, date) to authenticated, service_role;

-- A line's total: quantity x price rounded half up to the cent, less the
-- discount (an amount, or a percent of the rounded line, rounded). The
-- screens do the same in lib/calc/invoice.ts.
create or replace function public.invoice_line_total(
  p_kind text, p_quantity numeric, p_price numeric, p_discount_kind text, p_discount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_kind = 'shorted' then 0 else
    round(p_quantity * p_price, 2) - case
      when p_discount_kind = 'amount' then round(p_discount, 2)
      when p_discount_kind = 'percent' then round(round(p_quantity * p_price, 2) * p_discount / 100, 2)
      else 0 end
  end;
$$;

-- ---------------------------------------------------------------------------
-- Only the functions below change status and what was issued. A finalized
-- invoice's date and number can still be changed (the due date follows).
-- ---------------------------------------------------------------------------
create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('uvl.invoice_fn', true), '') = 'on';
  v_free text[] := array['invoice_date', 'number', 'due_date', 'updated_at', 'memo'];
begin
  if v_fn then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Use Finalize, Mark sent or Void to change an invoice.' using errcode = '42501';
  end if;
  if old.status <> 'draft' then
    if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
      raise exception 'This invoice is finalized; only its date and number can change.' using errcode = '42501';
    end if;
    if new.memo is distinct from old.memo then
      raise exception 'This invoice is finalized; only its date and number can change.' using errcode = '42501';
    end if;
    if new.invoice_date is distinct from old.invoice_date then
      new.due_date := new.invoice_date + coalesce(new.terms_days, 0);
    end if;
  end if;
  return new;
end;
$$;
create trigger invoices_guard before update on public.invoices
  for each row execute function public.invoices_guard();

-- ---------------------------------------------------------------------------
-- The boxes on a finalized invoice, as issued (the box detail page, and trace).
-- ---------------------------------------------------------------------------
create table public.invoice_boxes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  box_id uuid not null,
  product_id text not null,
  weight numeric not null,
  lot text,
  pack_date date,
  serial text,
  label_no int,
  case_no text,
  source text not null default 'weigh',
  created_at timestamptz not null default now()
);
create index invoice_boxes_invoice on public.invoice_boxes (invoice_id);
create index invoice_boxes_box on public.invoice_boxes (box_id);
comment on table public.invoice_boxes is
  'Copied from packing_weights when an invoice is finalized. box_id is the packing_weights id (no link, so a box record can still be fixed).';

alter table public.invoice_boxes enable row level security;
create policy "invoice_boxes: read" on public.invoice_boxes for select to authenticated
  using ((select public.can_view('invoices')));
revoke all on public.invoice_boxes from anon, authenticated;
grant select on public.invoice_boxes to authenticated;
grant all on public.invoice_boxes to service_role;

-- ---------------------------------------------------------------------------
-- Payments.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  paid_on date not null,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('ach', 'check', 'other')),
  reference text not null default '',
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index payments_invoice on public.payments (invoice_id);
comment on table public.payments is
  'Money received on an invoice: ACH, check or other, with the check number or ACH reference. Partial payments allowed.';

create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.audit_row();

-- Payments go on finalized (or sent) invoices only.
create or replace function public.payments_finalized_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.invoices where id = new.invoice_id;
  if v_status is null or v_status not in ('finalized', 'sent') then
    raise exception 'Payments go on a finalized invoice (not a draft or a void one).' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger payments_finalized_only before insert or update on public.payments
  for each row execute function public.payments_finalized_only();

alter table public.payments enable row level security;
create policy "payments: read" on public.payments for select to authenticated
  using ((select public.can_view('invoices')));
create policy "payments: change" on public.payments for all to authenticated
  using ((select public.can_change('invoices'))) with check ((select public.can_change('invoices')));
revoke all on public.payments from anon;
grant select, insert, update, delete on public.payments to authenticated;
grant all on public.payments to service_role;

-- ---------------------------------------------------------------------------
-- Finalize.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  s public.invoice_settings%rowtype;
  b public.customer_billing%rowtype;
  v_n int;
  v_terms int;
  v_name text;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to finalize invoices' using errcode = '42501';
  end if;
  select * into v from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'That invoice isn''t there any more.' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then
    raise exception 'This invoice is already finalized.' using errcode = '22023';
  end if;
  if v.number is null or btrim(v.number) = '' then
    raise exception 'This invoice needs a number first.' using errcode = '22023';
  end if;
  if v.fingerprint <> public.invoice_fingerprint(v.week_id, v.customer_id) then
    raise exception 'Packing changed since this draft was made. Update from packing first.' using errcode = '22023';
  end if;
  select count(*) into v_n from public.invoice_lines
  where invoice_id = p_invoice and kind <> 'shorted' and quantity is null;
  if v_n > 0 then
    raise exception '% line(s) need a count (Count needed).', v_n using errcode = '22023';
  end if;
  select count(*) into v_n from public.invoice_lines
  where invoice_id = p_invoice and kind <> 'shorted' and unit_price is null
    and public.price_on(product_id, v.customer_id, v.invoice_date) is null;
  if v_n > 0 then
    raise exception '% line(s) have no price (Price needed). Set them in Setup > Prices.', v_n using errcode = '22023';
  end if;

  -- The prices on the invoice date, onto the lines (still a draft here).
  update public.invoice_lines
  set unit_price = public.price_on(product_id, v.customer_id, v.invoice_date)
  where invoice_id = p_invoice and kind <> 'shorted' and unit_price is null;

  -- The boxes, as they are now.
  insert into public.invoice_boxes (invoice_id, box_id, product_id, weight, lot, pack_date, serial, label_no, case_no, source)
  select p_invoice, w.id, w.product_id, w.weight, w.lot, w.pack_date, w.serial, w.label_no, w.case_no, w.source
  from public.packing_weights w
  join public.orders o on o.id = w.order_id
  where o.week_id = v.week_id and o.customer_id = v.customer_id;

  select * into s from public.invoice_settings limit 1;
  select * into b from public.customer_billing where customer_id = v.customer_id;
  v_terms := coalesce(b.terms_days, s.default_terms_days, 15);
  select coalesce(p.name || ': ', '') || c.name into v_name
  from public.customers c left join public.customers p on p.id = c.parent_customer_id
  where c.id = v.customer_id;

  perform set_config('uvl.invoice_fn', 'on', true);
  update public.invoices set
    status = 'finalized',
    terms_days = v_terms,
    due_date = v.invoice_date + v_terms,
    total = (
      select coalesce(sum(public.invoice_line_total(kind, quantity, unit_price, discount_kind, discount)), 0)
      from public.invoice_lines where invoice_id = p_invoice),
    issued = jsonb_build_object(
      'customer_name', v_name,
      'bill_to', coalesce(b.bill_to_address, ''),
      'box_detail', coalesce(b.box_detail, false),
      'business_name', s.business_name,
      'business_address', s.business_address,
      'business_phone', s.business_phone,
      'business_email', s.business_email,
      'remit_to', s.remit_to,
      'invoice_note', s.invoice_note),
    finalized_at = now(),
    finalized_by = auth.uid()
  where id = p_invoice;
  perform set_config('uvl.invoice_fn', '', true);
end;
$$;
revoke execute on function public.finalize_invoice(uuid) from public, anon;
grant execute on function public.finalize_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sent (a mark; no emailing yet), and back.
-- ---------------------------------------------------------------------------
create or replace function public.mark_invoice_sent(p_invoice uuid, p_sent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to change invoices' using errcode = '42501';
  end if;
  select status into v_status from public.invoices where id = p_invoice for update;
  if v_status is null or v_status not in ('finalized', 'sent') then
    raise exception 'Only a finalized invoice can be marked sent.' using errcode = '22023';
  end if;
  perform set_config('uvl.invoice_fn', 'on', true);
  update public.invoices set
    status = case when p_sent then 'sent' else 'finalized' end,
    sent_at = case when p_sent then now() end,
    sent_by = case when p_sent then auth.uid() end
  where id = p_invoice;
  perform set_config('uvl.invoice_fn', '', true);
end;
$$;
revoke execute on function public.mark_invoice_sent(uuid, boolean) from public, anon;
grant execute on function public.mark_invoice_sent(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Void, with a reason. An invoice with payments can't be voided until they're
-- moved (deleted here, recorded on the reissued invoice).
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to void invoices' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why it''s void.' using errcode = '22023';
  end if;
  select status into v_status from public.invoices where id = p_invoice for update;
  if v_status is null or v_status not in ('finalized', 'sent') then
    raise exception 'Only a finalized invoice can be voided. A draft can be deleted.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice) then
    raise exception 'This invoice has payments. Delete them here first, then record them on the reissued invoice.' using errcode = '22023';
  end if;
  perform set_config('uvl.invoice_fn', 'on', true);
  update public.invoices set
    status = 'void', void_reason = btrim(p_reason), voided_at = now(), voided_by = auth.uid()
  where id = p_invoice;
  perform set_config('uvl.invoice_fn', '', true);
end;
$$;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reissue a void invoice: a new draft from packing as it is now, numbered
-- -R1, -R2..., with the same date, note, added lines and discounts.
-- ---------------------------------------------------------------------------
create or replace function public.reissue_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_n int;
  v_base text;
  v_id uuid;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to make invoices' using errcode = '42501';
  end if;
  select * into v from public.invoices where id = p_invoice;
  if not found or v.status <> 'void' then
    raise exception 'Only a void invoice can be reissued.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices
    where week_id = v.week_id and customer_id = v.customer_id and status <> 'void') then
    raise exception 'This location already has an invoice this week.' using errcode = '23505';
  end if;
  select coalesce(max(reissue), 0) + 1 into v_n from public.invoices
  where week_id = v.week_id and customer_id = v.customer_id;
  v_base := nullif(regexp_replace(coalesce(v.number, ''), '-R[0-9]+$', ''), '');
  insert into public.invoices (week_id, customer_id, number, reissue, invoice_date, memo, replaces_id, made_by)
  values (v.week_id, v.customer_id,
    coalesce(v_base || '-R' || v_n, public.invoice_number_for(v.week_id, v.customer_id, v_n)),
    v_n, v.invoice_date, v.memo, v.id, auth.uid())
  returning id into v_id;
  -- The old lines as a start (packing lines keep their discounts; prices come from the price list again).
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, unit_price, discount_kind, discount, not_on_order, note, sort, detail)
  select v_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, case when kind = 'manual' then unit_price end, discount_kind, discount, not_on_order, note, sort, detail
  from public.invoice_lines where invoice_id = p_invoice;
  perform public.refill_invoice_lines(v_id);
  return v_id;
end;
$$;
revoke execute on function public.reissue_invoice(uuid) from public, anon;
grant execute on function public.reissue_invoice(uuid) to authenticated, service_role;

-- Live updates.
alter table public.payments replica identity full;
alter publication supabase_realtime add table public.payments;
