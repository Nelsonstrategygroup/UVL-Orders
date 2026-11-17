-- Freight income (Lucas, 11/16/26), stage D of one list of expense
-- categories. Optional, per location (or a chain, for all its stores), in
-- Setup > Invoicing: none (the default), per pallet, per delivery, per box
-- or per lb, from a date on. When set, the invoice gets its own Freight line
-- (worked out on screen while a draft; stored when finalized, like the
-- Mohawk charge), and the P&L counts it as freight income. None is set.
--
-- Adds: freight_charges, freight_on(); 'freight' invoice lines (no product);
-- finalize_invoice() adds the Freight line; refill_invoice_lines() clears it
-- when an invoice is reopened. No existing row changes. One foreign key
-- (freight_charges -> customers; the first between them).
--
-- Undo: supabase/rollback/20261120000100_revert.sql

create table public.freight_charges (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  method text not null check (method in ('none', 'per_pallet', 'per_delivery', 'per_box', 'per_lb')),
  amount numeric(12, 4) not null default 0 check (amount >= 0),
  effective_from date not null,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (customer_id, effective_from)
);
comment on table public.freight_charges is
  'Freight charged to a location (or a chain''s stores) from effective_from on: none, per_pallet, per_delivery, per_box or per_lb × amount. No row: no freight.';

create trigger freight_charges_updated_at before update on public.freight_charges
  for each row execute function public.set_updated_at();
create trigger freight_charges_audit after insert or update or delete on public.freight_charges
  for each row execute function public.audit_row();
alter table public.freight_charges enable row level security;
create policy "freight_charges: read" on public.freight_charges for select to authenticated
  using ((select public.can_view_any(array['prices', 'invoices'])));
create policy "freight_charges: change" on public.freight_charges for all to authenticated
  using ((select public.can_change('invoices'))) with check ((select public.can_change('invoices')));
revoke all on public.freight_charges from anon;
grant select, insert, update, delete on public.freight_charges to authenticated;
grant all on public.freight_charges to service_role;
alter publication supabase_realtime add table public.freight_charges;

-- The location's own newest setting on or before the date, else its chain's.
create or replace function public.freight_on(p_customer uuid, p_date date)
returns table (method text, amount numeric)
language sql
stable
set search_path = ''
as $$
  select x.method, x.amount from (
    select 1 as pri, f.method, f.amount, f.effective_from from public.freight_charges f
      where f.customer_id = p_customer and f.effective_from <= p_date
    union all
    select 2, f.method, f.amount, f.effective_from from public.freight_charges f
      join public.customers s on s.parent_customer_id = f.customer_id
      where s.id = p_customer and f.effective_from <= p_date
  ) x
  order by x.pri, x.effective_from desc
  limit 1;
$$;
revoke execute on function public.freight_on(uuid, date) from public, anon;
grant execute on function public.freight_on(uuid, date) to authenticated, service_role;

alter table public.invoice_lines drop constraint invoice_lines_kind_check;
alter table public.invoice_lines add constraint invoice_lines_kind_check
  check (kind in ('packed', 'shorted', 'manual', 'inventory', 'charge', 'freight'));
alter table public.invoice_lines drop constraint invoice_lines_product;
alter table public.invoice_lines add constraint invoice_lines_product
  check (kind in ('manual', 'freight') or product_id is not null);

-- ---------------------------------------------------------------------------
-- Reopening clears the Freight line too (as in 20261115000100, plus 'freight').
-- ---------------------------------------------------------------------------
create or replace function public.refill_invoice_lines(p_invoice uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_manual int;
  v_kept jsonb;
begin
  select * into v from public.invoices where id = p_invoice;
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', l.product_id, 'discount_kind', l.discount_kind, 'discount', l.discount, 'note', l.note)), '[]')
    into v_kept
    from public.invoice_lines l
    where l.invoice_id = p_invoice and l.kind in ('packed', 'shorted')
      and (l.discount is not null or btrim(l.note) <> '');

  -- Charge lines too: a draft works them out on screen; finalizing adds them.
  delete from public.invoice_lines where invoice_id = p_invoice and kind in ('packed', 'shorted', 'charge', 'freight');

  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit,
    boxes, quantity, price_unit, not_on_order, sort, detail,
    discount_kind, discount, note
  )
  select p_invoice, f.kind, f.product_id, f.description, f.ordered_qty, f.ordered_unit,
    f.boxes, f.quantity, f.price_unit, f.not_on_order, f.sort, f.detail,
    -- A discount stays only while the product is still billed.
    case when f.kind = 'packed' then k.discount_kind end,
    case when f.kind = 'packed' then k.discount end,
    case when f.kind = 'packed' or k.discount is null then coalesce(k.note, '') else '' end
  from public.invoice_lines_from_packing(v.week_id, v.customer_id) f
  left join jsonb_to_recordset(v_kept) as k(product_id text, discount_kind text, discount numeric, note text)
    on k.product_id = f.product_id;

  -- Manual lines after the packing lines.
  select coalesce(max(sort), 0) into v_manual from public.invoice_lines
  where invoice_id = p_invoice and kind in ('packed', 'shorted');
  update public.invoice_lines l set sort = v_manual + s.n
  from (
    select id, row_number() over (order by sort, created_at) as n
    from public.invoice_lines where invoice_id = p_invoice and kind not in ('packed', 'shorted')
  ) s
  where l.id = s.id and l.sort <> v_manual + s.n;

  update public.invoices set fingerprint = public.invoice_fingerprint(v.week_id, v.customer_id)
  where id = p_invoice;
end;
$$;


-- ---------------------------------------------------------------------------
-- Finalize: as in 20261115000100, plus the Freight line.
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
  -- What's packed now, and the number as it should be.
  perform public.sync_invoice_draft(p_invoice);
  select * into v from public.invoices where id = p_invoice;
  if v.number is null or btrim(v.number) = '' then
    raise exception 'This invoice needs a number first.' using errcode = '22023';
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

  -- Per-carcass charges (Mohawk), one line under each product line that has
  -- one on the invoice date: carcasses x the charge. None when it's 0 (PCC).
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit,
    boxes, quantity, price_unit, unit_price, not_on_order, note, sort, detail)
  select p_invoice, 'charge', l.product_id, ch.name, null, '',
    0, coalesce(l.ordered_qty, l.boxes), 'each', ch.amount, false, '', l.sort, ''
  from public.invoice_lines l
  cross join lateral public.charge_on(l.product_id, v.customer_id, v.invoice_date) ch
  where l.invoice_id = p_invoice and l.kind = 'packed' and ch.amount > 0
    and coalesce(l.ordered_qty, l.boxes) > 0;

  -- Freight (Lucas, 11/16/26): one line at the end, when the location (or its
  -- chain) has freight set on the invoice date. Pallets: those carrying its
  -- boxes this week; boxes; lb: the boxes' weight; delivery: 1.
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit,
    boxes, quantity, price_unit, unit_price, not_on_order, note, sort, detail)
  select p_invoice, 'freight', null, 'Freight', null, '',
    0, q.qty, case when f.method = 'per_lb' then 'lb' else 'each' end, f.amount, false, '', 100000, ''
  from public.freight_on(v.customer_id, v.invoice_date) f
  cross join lateral (
    select case f.method
      when 'per_delivery' then 1
      when 'per_box' then count(w.id)
      when 'per_pallet' then count(distinct w.pallet_id)
      when 'per_lb' then coalesce(sum(w.weight), 0)
    end as qty
    from public.packing_weights w
    join public.orders o on o.id = w.order_id
    where o.week_id = v.week_id and o.customer_id = v.customer_id
  ) q
  where f.method <> 'none' and f.amount > 0 and q.qty > 0;

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

-- ---------------------------------------------------------------------------
-- Reopen (admins only): a finalized or sent invoice with no payments goes
-- back to a live draft. Its lines follow packing and the price list again;
revoke execute on function public.finalize_invoice(uuid) from public, anon;
grant execute on function public.finalize_invoice(uuid) to authenticated, service_role;
