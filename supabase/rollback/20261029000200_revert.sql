-- Undo 20261029000200_packed_together.sql: products are packed on their own
-- again, and invoice drafts go back to one line per product. Drafts made
-- since keep their lines until updated.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261029000200_revert.sql

begin;
drop function if exists public.invoice_lines_from_packing(date, uuid);
create function public.invoice_lines_from_packing(p_week date, p_customer uuid)
returns table (
  kind text, product_id text, description text, ordered_qty numeric, ordered_unit text,
  boxes int, quantity numeric, price_unit text, not_on_order boolean, sort int
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
      p.id, p.name, p.unit, p.price_unit, p.sort,
      ol.qty as ordered,
      coalesce(b.boxes, 0) as boxes,
      b.lb,
      pl.packed_qty,
      (b.product_id is not null or (p.price_unit = 'each' and coalesce(pl.packed_qty, 0) > 0)) as went_out
    from ids
    join public.products p on p.id = ids.product_id
    left join b on b.product_id = ids.product_id
    left join ol on ol.product_id = ids.product_id
    left join pl on pl.product_id = ids.product_id
  )
  select
    case when x.went_out then 'packed' else 'shorted' end,
    x.id,
    x.name,
    x.ordered,
    x.unit,
    x.boxes,
    case
      when not x.went_out then 0
      when x.price_unit = 'lb' then round(x.lb, 3)
      when x.price_unit = 'case' then x.boxes
      else round(x.packed_qty, 3)
    end,
    x.price_unit,
    x.went_out and x.ordered is null,
    (row_number() over (order by not x.went_out, x.sort, x.name))::int
  from x
  -- Only the shorted lines of products that were ordered (a count of 0 on
  -- a product not ordered isn't a line).
  where x.went_out or x.ordered is not null;
$$;
revoke execute on function public.invoice_lines_from_packing(date, uuid) from public, anon;
grant execute on function public.invoice_lines_from_packing(date, uuid) to authenticated, service_role;

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
      select string_agg(p.id || ':' || p.price_unit, '|' order by p.id)
      from public.products p
      where p.id in (
        select w.product_id from public.packing_weights w
        join public.orders o on o.id = w.order_id
        where o.week_id = p_week and o.customer_id = p_customer
        union
        select l.product_id from public.packing_lines l
        join public.orders o on o.id = l.order_id
        where o.week_id = p_week and o.customer_id = p_customer
      )
    ), '')
  );
$$;
revoke execute on function public.invoice_fingerprint(date, uuid) from public, anon;
grant execute on function public.invoice_fingerprint(date, uuid) to authenticated, service_role;

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
    boxes, quantity, price_unit, not_on_order, sort,
    discount_kind, discount, note
  )
  select p_invoice, f.kind, f.product_id, f.description, f.ordered_qty, f.ordered_unit,
    f.boxes, f.quantity, f.price_unit, f.not_on_order, f.sort,
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

drop function if exists public.pack_group_product(text);
alter table public.invoice_lines drop column if exists detail;
alter table public.products drop column if exists packed_with;
delete from supabase_migrations.schema_migrations where version = '20261029000200';
commit;
