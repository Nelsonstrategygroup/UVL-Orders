-- Products packed together in one box (Lucas, 10/29/26). Heart, Liver and
-- Kidney go in the same box: one box of any of them is that store's order
-- for all three. Box sizes don't apply to them for now. They're billed by
-- weight at one price for the group, as one invoice line ("Heart, Liver,
-- Kidney"): boxes and pounds, plus the packs counted on Packing if typed.
--
-- products.packed_with: a group name; products with the same one share a
-- box. Blank: packed on its own. Set in Setup > Products.
-- The group's price is on its first product (by sort): Setup > Prices shows
-- the group as one row.

alter table public.products add column packed_with text not null default '';
comment on column public.products.packed_with is
  'Products with the same name here are packed in one box (Organs: Heart, Liver, Kidney). One box of any is the order for all; one price, one invoice line. Blank: on its own.';
update public.products set packed_with = 'Organs' where id in ('cp-heart', 'cp-liver', 'cp-kidney');

-- The packs counted on Packing, printed under a group's line.
alter table public.invoice_lines add column detail text not null default '';
comment on column public.invoice_lines.detail is
  'Printed under the line: for products packed together, the pieces counted on Packing ("2 Heart, 5 Liver").';

-- The product a group is priced and billed under: its first by sort.
create or replace function public.pack_group_product(p_product text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select g.id from public.products p
    join public.products g on btrim(g.packed_with) = btrim(p.packed_with)
    where p.id = p_product and btrim(p.packed_with) <> ''
    order by g.sort, g.id
    limit 1
  ), p_product);
$$;
revoke execute on function public.pack_group_product(text) from public, anon;
grant execute on function public.pack_group_product(text) to authenticated, service_role;

-- The invoice lines packing gives, with products packed together as one line.
drop function if exists public.invoice_lines_from_packing(date, uuid);
create function public.invoice_lines_from_packing(p_week date, p_customer uuid)
returns table (
  kind text, product_id text, description text, ordered_qty numeric, ordered_unit text,
  boxes int, quantity numeric, price_unit text, not_on_order boolean, sort int, detail text
)
language sql
stable
set search_path = ''
as $$
  with o as (
    select id from public.orders where week_id = p_week and customer_id = p_customer
  ),
  b as (
    select w.product_id, count(*)::int as boxes, sum(w.weight) as lb
    from public.packing_weights w where w.order_id in (select id from o)
    group by w.product_id
  ),
  ol as (
    select l.product_id, sum(l.qty) as qty from public.order_lines l
    where l.order_id in (select id from o) group by l.product_id
  ),
  pl as (
    select l.product_id, sum(l.packed_qty) as packed_qty from public.packing_lines l
    where l.order_id in (select id from o) group by l.product_id
  ),
  ids as (
    select b.product_id from b
    union select ol.product_id from ol
    union select pl.product_id from pl
      join public.products p on p.id = pl.product_id
      where p.price_unit = 'each' and pl.packed_qty > 0
  ),
  x as (
    select
      p.id, p.name, p.unit, p.sort,
      public.pack_group_product(p.id) as grp,
      btrim(p.packed_with) <> '' as together,
      ol.qty as ordered,
      coalesce(b.boxes, 0) as boxes,
      b.lb,
      pl.packed_qty
    from ids
    join public.products p on p.id = ids.product_id
    left join b on b.product_id = ids.product_id
    left join ol on ol.product_id = ids.product_id
    left join pl on pl.product_id = ids.product_id
  ),
  g as (
    select
      x.grp,
      bool_or(x.together) as together,
      count(*) as members,
      sum(x.boxes)::int as boxes,
      sum(x.lb) as lb,
      sum(x.packed_qty) as packed_qty,
      sum(x.ordered) as ordered,
      bool_or(x.ordered is not null) as any_ordered,
      min(x.sort) as sort,
      string_agg(x.name, ', ' order by x.sort, x.name) as names,
      string_agg(trim_scale(x.packed_qty)::text || ' ' || x.name, ', ' order by x.sort, x.name)
        filter (where x.packed_qty is not null) as counted
    from x group by x.grp
  ),
  y as (
    select g.*, p.price_unit, p.name as grp_name, p.unit as grp_unit,
      (g.boxes > 0 or (p.price_unit = 'each' and coalesce(g.packed_qty, 0) > 0)) as went_out
    from g join public.products p on p.id = g.grp
  )
  select
    case when y.went_out then 'packed' else 'shorted' end,
    y.grp,
    case when y.together then y.names else y.grp_name end,
    -- Packed together: weight only, no ordered amount.
    case when y.together then null else y.ordered end,
    case when y.together then '' else y.grp_unit end,
    y.boxes,
    case
      when not y.went_out then 0
      when y.price_unit = 'lb' then round(y.lb, 3)
      when y.price_unit = 'case' then y.boxes
      else round(y.packed_qty, 3)
    end,
    y.price_unit,
    y.went_out and not y.any_ordered,
    (row_number() over (order by not y.went_out, y.sort, y.names))::int,
    case when y.together and y.went_out then coalesce(y.counted, '') else '' end
  from y
  -- Only the shorted lines of products that were ordered.
  where y.went_out or y.any_ordered;
$$;
revoke execute on function public.invoice_lines_from_packing(date, uuid) from public, anon;
grant execute on function public.invoice_lines_from_packing(date, uuid) to authenticated, service_role;

-- The fingerprint also covers which products are packed together.
create or replace function public.invoice_fingerprint(p_week date, p_customer uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select md5(
    coalesce((
      select string_agg(w.id::text || ':' || w.product_id || ':' || w.weight::text, '|' order by w.id)
      from public.packing_weights w
      join public.orders o on o.id = w.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(l.product_id || ':' || coalesce(l.packed_qty::text, '-'), '|' order by l.product_id)
      from public.packing_lines l
      join public.orders o on o.id = l.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(l.product_id || ':' || l.qty::text, '|' order by l.product_id)
      from public.order_lines l
      join public.orders o on o.id = l.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(p.id || ':' || p.price_unit || ':' || p.packed_with, '|' order by p.id)
      from public.products p
      where p.id in (
        select w.product_id from public.packing_weights w
        join public.orders o on o.id = w.order_id
        where o.week_id = p_week and o.customer_id = p_customer
        union
        select l.product_id from public.packing_lines l
        join public.orders o on o.id = l.order_id
        where o.week_id = p_week and o.customer_id = p_customer
        union
        select l.product_id from public.order_lines l
        join public.orders o on o.id = l.order_id
        where o.week_id = p_week and o.customer_id = p_customer
      )
    ), '')
  );
$$;

-- Refill carries the detail line too (otherwise as before).
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

  delete from public.invoice_lines where invoice_id = p_invoice and kind in ('packed', 'shorted');

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

  update public.invoices set
    fingerprint = public.invoice_fingerprint(v.week_id, v.customer_id),
    number = coalesce(number, public.invoice_number_for(v.week_id, v.customer_id, v.reissue))
  where id = p_invoice;
end;
$$;
revoke execute on function public.refill_invoice_lines(uuid) from public, anon;
