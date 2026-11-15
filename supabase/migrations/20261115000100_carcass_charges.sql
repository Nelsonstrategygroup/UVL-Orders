-- Carcass Lamb pricing (Lucas, 11/15/26; Kathy's numbers from 11/11/26,
-- starting numbers, not confirmed): carcass weight x $6.00/lb, plus a flat
-- Mohawk charge per carcass on its own invoice line. Custom Cut Lamb is a new,
-- separate product: cut and boxed to the customer's requests, $6.00/lb on the
-- box weights (for now) plus a $100 Mohawk charge. PCC keeps its $8.25/lb and
-- gets no Mohawk charge ($0 on the PCC chain), until Lucas says otherwise.
--
-- Adds: carcass_charges (a charge per carcass for a product, from a date, the
-- default or a customer's or chain's own, like prices), charge_on(), the
-- 'charge' invoice line kind, and the product Custom Cut Lamb. Changes: the
-- invoice line kind check (one more kind), refill_invoice_lines() (also
-- clears charge lines) and finalize_invoice() (adds them). No other product
-- is priced or invoiced differently; invoices with no charge are unchanged.
--
-- A draft shows its charge lines on screen (lib/calc/invoice.ts) from today's
-- charges; finalizing stores them, priced, like every other line.
--
-- Undo: supabase/rollback/20261115000100_revert.sql

-- ---------------------------------------------------------------------------
-- Charges per carcass
-- ---------------------------------------------------------------------------
create table public.carcass_charges (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  amount numeric(12, 2) not null check (amount >= 0),
  effective_from date not null,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index carcass_charges_one_per_day on public.carcass_charges
  (product_id, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);
comment on table public.carcass_charges is
  'A charge per carcass (Mohawk) on top of the per-lb price, from effective_from on. customer_id blank: everyone; a chain''s applies to its stores; 0 means none. name is the invoice line.';

create trigger carcass_charges_updated_at before update on public.carcass_charges
  for each row execute function public.set_updated_at();
create trigger carcass_charges_audit after insert or update or delete on public.carcass_charges
  for each row execute function public.audit_row();

alter table public.carcass_charges enable row level security;
create policy "carcass_charges: read" on public.carcass_charges for select to authenticated
  using ((select public.can_view_any(array['prices', 'invoices'])));
create policy "carcass_charges: change" on public.carcass_charges for all to authenticated
  using ((select public.can_change('prices'))) with check ((select public.can_change('prices')));
revoke all on public.carcass_charges from anon;
grant select, insert, update, delete on public.carcass_charges to authenticated;
grant all on public.carcass_charges to service_role;
alter publication supabase_realtime add table public.carcass_charges;

-- The charge on a date: the store's own newest, else its chain's, else the
-- default (as price_on). No row: no charge.
create or replace function public.charge_on(p_product text, p_customer uuid, p_date date)
returns table (name text, amount numeric)
language sql
stable
set search_path = ''
as $$
  select x.name, x.amount from (
    select 1 as pri, c.name, c.amount, c.effective_from from public.carcass_charges c
      where c.product_id = p_product and c.customer_id = p_customer and c.effective_from <= p_date
    union all
    select 2, c.name, c.amount, c.effective_from from public.carcass_charges c
      join public.customers s on s.parent_customer_id = c.customer_id
      where c.product_id = p_product and s.id = p_customer and c.effective_from <= p_date
    union all
    select 3, c.name, c.amount, c.effective_from from public.carcass_charges c
      where c.product_id = p_product and c.customer_id is null and c.effective_from <= p_date
  ) x
  order by x.pri, x.effective_from desc
  limit 1;
$$;
revoke execute on function public.charge_on(text, uuid, date) from public, anon;
grant execute on function public.charge_on(text, uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The charge line kind
-- ---------------------------------------------------------------------------
alter table public.invoice_lines drop constraint invoice_lines_kind_check;
alter table public.invoice_lines add constraint invoice_lines_kind_check
  check (kind in ('packed', 'shorted', 'manual', 'inventory', 'charge'));

-- ---------------------------------------------------------------------------
-- Custom Cut Lamb: like Carcass Lamb (an extra lamb on top of the count that
-- uses none of the week's parts), but cut and boxed to the customer's
-- requests. Left as "Needs checking" in Setup > Products, with no box sizes.
-- ---------------------------------------------------------------------------
insert into public.products (
  id, name, unit, group_name, price_unit, billed_by_weight, carcass, counts_toward_lambs,
  confirmed, active, sort, order_step, note)
select 'cp-custom-cut-lamb', 'Custom Cut Lamb', 'each', 'Whole lambs', 'lb', true, true, true,
  false, true, 115, 1,
  'One entire lamb, cut and boxed to the customer''s requests. Write how to cut it in the order''s note. Adds one lamb to the count.'
where exists (select 1 from public.products where id = 'cp-carcass-lamb')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Starting numbers (Kathy, 11/11/26), from 10/8/26 like the other prices.
-- ---------------------------------------------------------------------------
insert into public.prices (product_id, customer_id, price, effective_from, note)
select p.id, null, 6.00, '2026-10-08', 'Starting price (Kathy 11/11/26): carcass weight x $6.00 plus the Mohawk charge'
from public.products p
where p.id in ('cp-carcass-lamb', 'cp-custom-cut-lamb')
  and not exists (select 1 from public.prices x
    where x.product_id = p.id and x.customer_id is null and x.effective_from = '2026-10-08');

insert into public.carcass_charges (product_id, customer_id, name, amount, effective_from, note)
select v.product_id, null, v.name, v.amount, '2026-10-08', 'Starting charge (Kathy 11/11/26)'
from (values
  ('cp-carcass-lamb', 'Mohawk charge, shrouded carcass', 40.00),
  ('cp-custom-cut-lamb', 'Mohawk charge, custom cut', 100.00)
) as v(product_id, name, amount)
where exists (select 1 from public.products p where p.id = v.product_id)
on conflict do nothing;

-- PCC: no Mohawk charge (their own price sheet may already include it).
insert into public.carcass_charges (product_id, customer_id, name, amount, effective_from, note)
select v.product_id, c.id, v.name, 0, '2026-10-08', 'PCC: no Mohawk charge (Lucas 11/15/26)'
from (values
  ('cp-carcass-lamb', 'Mohawk charge, shrouded carcass'),
  ('cp-custom-cut-lamb', 'Mohawk charge, custom cut')
) as v(product_id, name)
join public.customers c on c.name = 'PCC' and c.parent_customer_id is null
where exists (select 1 from public.products p where p.id = v.product_id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Drafts: refill also clears charge lines (a reissue copies them from the void
-- invoice). Otherwise as in 20261108000100.
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
  delete from public.invoice_lines where invoice_id = p_invoice and kind in ('packed', 'shorted', 'charge');

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
revoke execute on function public.refill_invoice_lines(uuid) from public, anon;

revoke execute on function public.refill_invoice_lines(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Finalize: as in 20261108000100, plus the per-carcass charge lines.
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
