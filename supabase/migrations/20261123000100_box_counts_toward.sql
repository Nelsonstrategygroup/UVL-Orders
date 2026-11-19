-- Shank boxes count toward Mixed Shanks (Kathy's rule; Lucas, 11/18/26).
--
-- Mohawk labels these boxes Front Shanks or Hind Shanks. A store that ordered
-- Mixed Shanks is filled from them, so such a box counts, ships and bills as
-- Mixed Shanks. The store's own Front or Hind line is filled first.
--
-- products.fills_product_id says which product a box may count toward (set in
-- Setup > Products). packing_weights.product_id stays "what this box counts
-- as", so packing, manifests and invoices all follow it; label_product_id
-- keeps what Mohawk's label says when that's different. The GTIN and serial
-- never change.
--
-- The correction columns are used by the next migration (a box's product
-- changed by hand). A corrected box is left alone by this rule.
--
-- Neither new product column is a foreign key: packing_weights and products
-- already have one link, and a second breaks API embeds (10/26/26 outage).
--
-- Also: Mixed Shanks draws front shanks first (Lucas, 11/18/26; still set in
-- Setup > Products), and the boxes this rule covers are put right. Only draft
-- invoices in open weeks change.
--
-- Undo: supabase/rollback/20261123000100_revert.sql

alter table public.products add column fills_product_id text;
comment on column public.products.fills_product_id is
  'A box of this product counts toward that product on an order that has it and no open line of this one (Front and Hind Shanks: Mixed Shanks). A product id; no foreign key on purpose.';

alter table public.packing_weights
  add column label_product_id text,
  add column corrected_at timestamptz,
  add column corrected_by uuid,
  add column correction_reason text,
  add constraint packing_weights_correction_reason check (correction_reason is null or btrim(correction_reason) <> '');
comment on column public.packing_weights.label_product_id is
  'The product on Mohawk''s label, when the box counts as another product (product_id). Null when they are the same. No foreign key on purpose.';
comment on column public.packing_weights.corrected_at is 'When someone changed this box''s product by hand.';
comment on column public.packing_weights.corrected_by is 'Who changed it (a profiles id; no foreign key on purpose).';
comment on column public.packing_weights.correction_reason is 'Why it was changed by hand. Set means the shank rule leaves this box alone.';

-- On this order: the product itself, or one packed in the same box.
create or replace function public.box_on_order(p_order uuid, p_product text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_lines l
    join public.products p on p.id = l.product_id
    join public.products me on me.id = p_product
    where l.order_id = p_order
      and case when l.only_if_extra then coalesce(l.fill_qty, 0) else l.qty end > 0
      and (l.product_id = p_product or (btrim(me.packed_with) <> '' and p.packed_with = me.packed_with))
  );
$$;
revoke execute on function public.box_on_order(uuid, text) from public, anon;
grant execute on function public.box_on_order(uuid, text) to authenticated, service_role;

-- What a box labeled p_label counts as on this order. Its own line first,
-- until that line has its boxes (its box labels for the week, or one box
-- when it has none); then the product it fills, if that's on the order.
create or replace function public.box_counts_as(p_order uuid, p_label text, p_box uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target text;
  v_week date;
  v_customer uuid;
  v_planned int;
  v_have int;
begin
  select fills_product_id into v_target from public.products where id = p_label;
  if v_target is null or p_order is null then return p_label; end if;
  if not public.box_on_order(p_order, v_target) then return p_label; end if;
  if not public.box_on_order(p_order, p_label) then return v_target; end if;

  select week_id, customer_id into v_week, v_customer from public.orders where id = p_order;
  select count(*) into v_planned from public.box_labels
  where week_id = v_week and key like v_customer::text || '|' || p_label || '|%';
  select count(*) into v_have from public.packing_weights
  where order_id = p_order and product_id = p_label and id is distinct from p_box;
  return case when v_have >= greatest(v_planned, 1) then v_target else p_label end;
end;
$$;
revoke execute on function public.box_counts_as(uuid, text, uuid) from public, anon;
grant execute on function public.box_counts_as(uuid, text, uuid) to authenticated, service_role;

-- Every way a box reaches a store goes through here: scanned, typed, moved, assigned.
create or replace function public.packing_weights_counts_as()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
  v_target text;
  v_fills text;
  v_was text := case when tg_op = 'UPDATE' then old.product_id end;
begin
  if new.correction_reason is not null then return new; end if;

  -- Someone set the product outright: that's the box's product now.
  v_label := case
    when tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then new.product_id
    else coalesce(new.label_product_id, new.product_id)
  end;
  select fills_product_id into v_fills from public.products where id = v_label;
  if v_fills is null and new.label_product_id is null then return new; end if;

  v_target := public.box_counts_as(new.order_id, v_label, new.id);
  new.product_id := v_target;
  new.label_product_id := nullif(v_label, v_target);

  if new.order_id is not null then
    new.off_order := not public.box_on_order(new.order_id, v_target);
    if not new.off_order then
      new.extra_ok_by := null;
      new.extra_ok_at := null;
    end if;
    -- Now in another product's row: the next free box there, if its place is taken.
    if v_target is distinct from v_was and new.slot is not null and exists (
      select 1 from public.packing_weights w
      where w.order_id = new.order_id and w.product_id = v_target and w.slot = new.slot and w.id is distinct from new.id
    ) then
      select coalesce(max(w.slot), 0) + 1 into new.slot
      from public.packing_weights w
      where w.order_id = new.order_id and w.product_id = v_target and w.id is distinct from new.id;
      new.label_no := null;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.packing_weights_counts_as() from public, anon, authenticated;

create trigger packing_weights_counts_as before insert or update of order_id, product_id, label_product_id on public.packing_weights
  for each row execute function public.packing_weights_counts_as();

-- Boxes on an order sorted again, after its lines change. Finalized invoices
-- and closed weeks stay as they are.
create or replace function public.refresh_box_counts(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week date;
  v_customer uuid;
begin
  select week_id, customer_id into v_week, v_customer from public.orders where id = p_order;
  if v_week is null or public.week_is_closed(v_week) then return; end if;
  if exists (select 1 from public.invoices i where i.week_id = v_week and i.customer_id = v_customer and i.status in ('finalized', 'sent')) then return; end if;
  perform set_config('uvl.source', 'order changed: shank boxes sorted again', true);
  update public.packing_weights w
  set order_id = w.order_id
  where w.order_id = p_order
    and w.correction_reason is null
    and exists (select 1 from public.products p where p.id = coalesce(w.label_product_id, w.product_id) and p.fills_product_id is not null)
    and public.box_counts_as(p_order, coalesce(w.label_product_id, w.product_id), w.id) <> w.product_id;
end;
$$;
revoke execute on function public.refresh_box_counts(uuid) from public, anon, authenticated;

create or replace function public.order_lines_box_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_product text := coalesce(new.product_id, old.product_id);
begin
  if exists (select 1 from public.products p where p.fills_product_id = v_product or (p.id = v_product and p.fills_product_id is not null)) then
    perform public.refresh_box_counts(v_order);
  end if;
  return null;
end;
$$;
revoke execute on function public.order_lines_box_counts() from public, anon, authenticated;

create trigger order_lines_box_counts after insert or update of qty, fill_qty, only_if_extra, product_id or delete on public.order_lines
  for each row execute function public.order_lines_box_counts();

-- Front and Hind Shanks fill Mixed Shanks; Mixed Shanks draws front first.
update public.products
set fills_product_id = 'd090766f-1126-49a9-be72-c6ad0b8b36d3'
where id in ('cp-front-shanks', 'cp-hind-shanks')
  and exists (select 1 from public.products where id = 'd090766f-1126-49a9-be72-c6ad0b8b36d3');

update public.products
set draws_from = array['fshank', 'hshank']
where id = 'd090766f-1126-49a9-be72-c6ad0b8b36d3';

-- The boxes already on such orders (Bothell and Burien, weeks of Nov 2 and Nov 16).
select set_config('uvl.source', 'shank rule: counts toward Mixed Shanks (Lucas, 11/18/26)', true);
update public.packing_weights w
set order_id = w.order_id
from public.orders o
where o.id = w.order_id
  and w.correction_reason is null
  and exists (select 1 from public.products p where p.id = w.product_id and p.fills_product_id is not null)
  and not public.week_is_closed(o.week_id)
  and not exists (select 1 from public.invoices i where i.week_id = o.week_id and i.customer_id = o.customer_id and i.status in ('finalized', 'sent'))
  and public.box_counts_as(w.order_id, w.product_id, w.id) <> w.product_id;
select set_config('uvl.source', '', true);
