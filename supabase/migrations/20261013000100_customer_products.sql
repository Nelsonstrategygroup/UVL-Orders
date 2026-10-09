-- Customer products (2026-10 change requests, item 1 to 4).
--
-- Products become what customers order, in their words ("Chops", "Short
-- Loin"). Mohawk's wording stays in cut_specs and only shows on the cut
-- sheet. A product links to one or more cut-sheet lines. The 36 old products
-- (copies of Mohawk lines) are turned off, never deleted, so old orders and
-- exports keep working.
--
-- Every starting value below is marked confirmed = false so Setup lists it
-- under "Needs checking" until Kathy confirms or changes it.

-- ---------------------------------------------------------------------------
-- Products: how they're ordered, converted, and counted.
-- ---------------------------------------------------------------------------
alter table public.products drop constraint products_unit_check;
alter table public.products add constraint products_unit_check
  check (unit in ('each', 'pack', 'lb', 'case', 'leg', 'loin', 'lamb'));

alter table public.products drop constraint products_group_name_check;
alter table public.products add constraint products_group_name_check check (btrim(group_name) <> '');

alter table public.products
  -- A second unit customers may order in ("BLS Shoulder: pieces or lb").
  add column alt_unit text check (alt_unit in ('each', 'pack', 'lb', 'case')),
  -- About how much one unit weighs, to turn pounds into pieces and back.
  add column lb_per_unit numeric check (lb_per_unit > 0),
  add column pieces_per_pack numeric check (pieces_per_pack > 0),
  -- The + and - buttons move by this much (Le Trim: 10 lb).
  add column order_step numeric not null default 1 check (order_step > 0),
  add column billed_by_weight boolean not null default true,
  -- Off for a product that should never drive the lamb count, whatever it uses.
  add column counts_toward_lambs boolean not null default true,
  -- Not from a lamb at all (pepper sticks): no parts, counted not weighed.
  add column not_lamb boolean not null default false,
  add column confirmed boolean not null default true,
  add constraint products_alt_unit_differs check (alt_unit is null or alt_unit <> unit);

comment on column public.products.cut_spec_id is 'Old single link; replaced by product_cut_specs.';

-- ---------------------------------------------------------------------------
-- Parts: which ones drive the lamb count. Byproducts are still tracked per
-- lamb (what a lamb gives) but never set the count.
-- ---------------------------------------------------------------------------
alter table public.parts add column drives_count boolean not null default true;

-- ---------------------------------------------------------------------------
-- A product links to one or more cut-sheet lines. units_per_cut: how many of
-- the product's order unit one Mohawk line gives (Chops: 2.5 lb per short loin).
-- ---------------------------------------------------------------------------
create table public.product_cut_specs (
  product_id text not null references public.products (id) on delete cascade,
  cut_spec_id text not null references public.cut_specs (id) on delete cascade,
  units_per_cut numeric not null default 1 check (units_per_cut > 0),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (product_id, cut_spec_id)
);

alter table public.product_cut_specs enable row level security;
create policy "product_cut_specs: staff all" on public.product_cut_specs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.product_cut_specs from anon;
grant select, insert, update, delete on public.product_cut_specs to authenticated;

create trigger product_cut_specs_updated_at before update on public.product_cut_specs
  for each row execute function public.set_updated_at();
create trigger product_cut_specs_audit after insert or update or delete on public.product_cut_specs
  for each row execute function public.audit_row('product_id', 'cut_spec_id');

insert into public.product_cut_specs (product_id, cut_spec_id)
select id, cut_spec_id from public.products where cut_spec_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Order lines remember the unit they were taken in. Null means the product's
-- own unit.
-- ---------------------------------------------------------------------------
alter table public.order_lines
  add column unit text check (unit in ('each', 'pack', 'lb', 'case'));

-- ---------------------------------------------------------------------------
-- Saving an order, now with units: p_units is {product id: unit} for lines
-- taken in a unit other than the product's own.
-- ---------------------------------------------------------------------------
drop function public.set_order(date, uuid, text, text, jsonb);

create function public.set_order(
  p_week date,
  p_customer uuid,
  p_status text default null,
  p_notes text default null,
  p_lines jsonb default null,
  p_units jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_new_status text;
  v_has_lines boolean;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change orders.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('todo', 'ordered', 'none', 'callback') then
    raise exception 'Unknown order status: %', p_status using errcode = '22023';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'object' then
    raise exception 'Order lines must be an object of product id to quantity.' using errcode = '22023';
  end if;
  if p_units is not null and jsonb_typeof(p_units) <> 'object' then
    raise exception 'Units must be an object of product id to unit.' using errcode = '22023';
  end if;

  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  insert into public.orders (week_id, customer_id) values (p_week, p_customer)
    on conflict (week_id, customer_id) do nothing;

  select o.id, o.status into v_id, v_status
  from public.orders o
  where o.week_id = p_week and o.customer_id = p_customer
  for update;

  if p_lines is not null then
    delete from public.order_lines l
    where l.order_id = v_id
      and not exists (
        select 1 from jsonb_each_text(p_lines) e
        where e.key = l.product_id and e.value::numeric > 0
      );

    insert into public.order_lines (order_id, product_id, qty, unit)
    select v_id, e.key, e.value::numeric,
      -- Only store a unit when it differs from the product's own.
      nullif(p_units ->> e.key, (select p.unit from public.products p where p.id = e.key))
    from jsonb_each_text(p_lines) e
    where e.value::numeric > 0
    on conflict (order_id, product_id) do update
      set qty = excluded.qty, unit = excluded.unit
      where public.order_lines.qty is distinct from excluded.qty
         or public.order_lines.unit is distinct from excluded.unit;
  end if;

  select exists (select 1 from public.order_lines l where l.order_id = v_id) into v_has_lines;

  v_new_status := coalesce(p_status, v_status);
  if p_status is null and v_has_lines and v_status in ('todo', 'none') then
    v_new_status := 'ordered';
  end if;

  update public.orders o
  set status = v_new_status,
      notes = coalesce(p_notes, o.notes)
  where o.id = v_id
    and (o.status is distinct from v_new_status or (p_notes is not null and o.notes is distinct from p_notes));

  return v_id;
end;
$$;

revoke execute on function public.set_order(date, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.set_order(date, uuid, text, text, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- An order line in the product's own unit. Pounds become pieces (and back)
-- with lb_per_unit; without it the line can't be converted and counts as 0.
-- ---------------------------------------------------------------------------
create or replace function public.qty_in_product_unit(p_qty numeric, p_line_unit text, p_unit text, p_lb_per_unit numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_line_unit is null or p_line_unit = p_unit then p_qty
    when p_line_unit = 'lb' then coalesce(p_qty / nullif(p_lb_per_unit, 0), 0)
    when p_unit = 'lb' then coalesce(p_qty * p_lb_per_unit, 0)
    else p_qty
  end;
$$;

-- ---------------------------------------------------------------------------
-- "Put these on this set": each product adds to every Mohawk line it links
-- to, as (quantity in its own unit) / units_per_cut, rounded up to whole.
-- ---------------------------------------------------------------------------
create or replace function public.fill_cut_set(p_set uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before jsonb;
  v_week date;
  v_lambs int;
  v_sort int;
  v_added int := 0;
  v_most numeric;
  r record;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change the cut sheet.' using errcode = '42501';
  end if;

  select s.week_id, s.lambs into v_week, v_lambs from public.cut_sets s where s.id = p_set for update;
  if v_week is null then
    raise exception 'That set no longer exists.' using errcode = 'P0002';
  end if;
  v_before := public.cut_set_snapshot(p_set);

  select coalesce(max(sort), -1) into v_sort from public.cut_set_lines where set_id = p_set;

  for r in
    select pc.cut_spec_id,
      ceil(sum(public.qty_in_product_unit(l.qty, l.unit, p.unit, p.lb_per_unit) / pc.units_per_cut)) as qty
    from public.cut_set_customers c
    join public.orders o on o.customer_id = c.customer_id and o.week_id = v_week
    join public.order_lines l on l.order_id = o.id
    join public.products p on p.id = l.product_id
    join public.product_cut_specs pc on pc.product_id = p.id
    where c.set_id = p_set
    group by pc.cut_spec_id
    having ceil(sum(public.qty_in_product_unit(l.qty, l.unit, p.unit, p.lb_per_unit) / pc.units_per_cut)) > 0
    order by min(p.sort), min(pc.sort)
  loop
    update public.cut_set_lines
    set qty = coalesce(qty, 0) + r.qty
    where id = (
      select id from public.cut_set_lines
      where set_id = p_set and kind = 'line' and cut_spec_id = r.cut_spec_id
      order by sort limit 1
    );
    if not found then
      v_sort := v_sort + 1;
      insert into public.cut_set_lines (set_id, kind, cut_spec_id, qty, sort)
      values (p_set, 'line', r.cut_spec_id, r.qty, v_sort);
    end if;
    v_added := v_added + 1;
  end loop;

  if coalesce(v_lambs, 0) = 0 then
    select max(t.used) into v_most
    from (
      select u.part_id, sum(coalesce(l.qty, 0) * u.mult) as used
      from public.cut_set_lines l
      join public.cut_specs sp on sp.id = l.cut_spec_id
      cross join lateral public.cut_use_parts(sp.use_type, l.shank_on) u
      where l.set_id = p_set and l.kind = 'line'
      group by u.part_id
    ) t;
    if coalesce(v_most, 0) > 0 then
      update public.cut_sets set lambs = ceil(v_most / 2) where id = p_set;
    end if;
  end if;

  update public.cut_sets set filled_week = v_week where id = p_set;
  return jsonb_build_object('added', v_added, 'before', v_before);
end;
$$;

-- ---------------------------------------------------------------------------
-- A new Mohawk instruction (from the cut sheet) is only a cut sheet line now.
-- It no longer makes a matching product: customers order customer products,
-- which Kathy links to instructions in Setup.
-- ---------------------------------------------------------------------------
create or replace function public.add_cut_spec(p_text text, p_use_type text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_spec text;
  v_text text := trim(p_text);
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can add instructions.' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Write the instruction.' using errcode = '22023';
  end if;

  insert into public.cut_specs (text, use_type, sort)
  values (v_text, p_use_type, (select coalesce(max(sort), -1) + 1 from public.cut_specs))
  returning id into v_spec;
  return v_spec;
end;
$$;

revoke execute on function public.qty_in_product_unit(numeric, text, text, numeric) from public, anon;
grant execute on function public.qty_in_product_unit(numeric, text, text, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The starting list (change request items 1 and 3), all "not confirmed".
-- It runs once: here for a database that already has its catalog, or from
-- npm run seed on a new one (after parts and cut specs are loaded). After
-- that, Setup is where products change; reruns never undo Kathy's edits.
-- ---------------------------------------------------------------------------
alter table public.app_settings add column customer_products_seeded_at timestamptz;

create or replace function public.seed_customer_products()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select customer_products_seeded_at from public.app_settings limit 1) is not null then
    return 'already done';
  end if;
  if not exists (select 1 from public.parts where id = 'loin') then
    return 'waiting for the catalog (run npm run seed)';
  end if;

  -- The old products are copies of Mohawk lines: off for ordering, kept for history.
  update public.products set active = false where id not like 'cp-%';

  -- Parts: byproducts are tracked per lamb but don't drive the count.
  update public.parts set drives_count = false, confirmed = false where id = 'hshank'; -- Kathy leaned no
  update public.parts set drives_count = false where id in ('neck', 'trim');
  insert into public.parts (id, name, per_lamb, unit, balance_check, confirmed, source_note, sort, drives_count)
  values ('denver', 'Denver ribs', 2, 'each', false, false, 'Change request 10/2026: 2 per lamb, a byproduct.', 8, false)
  on conflict (id) do nothing;

  insert into public.products
    (id, name, unit, alt_unit, group_name, lb_per_unit, pieces_per_pack, order_step, billed_by_weight, confirmed, sort, note)
  values
    ('cp-whole-lamb', 'Whole Lamb', 'each', null, 'Whole lambs', null, null, 1, true, false, 100,
     'Goes out uncut. Billed by the carcass weight.'),
    ('cp-chops', 'Chops', 'lb', null, 'Loins and chops', null, 4, 1, true, false, 200,
     'About 2.5 lb of chops per short loin (2.25 to 2.75 depending on lamb size). A 4-pack is about 1.3 lb. 6 chops per short loin, cut 1 1/4 in.'),
    ('cp-thick-chops', 'Thick Chops', 'lb', null, 'Loins and chops', null, null, 1, true, false, 210,
     'Cut 1 1/2 in. 4 chops per short loin.'),
    ('cp-labeled-chops', 'Labeled Chops', 'lb', null, 'Loins and chops', null, 4, 1, true, false, 220,
     'Same as Chops, but each pack is weighed and labeled for retail sale.'),
    ('cp-short-loin', 'Short Loin', 'each', null, 'Loins and chops', null, null, 1, true, false, 230,
     'Ordered in pieces, billed by weight. Shown as "BI Loin" on the old paper sheet.'),
    ('cp-french-rack', 'French Rack', 'each', null, 'Racks', null, null, 1, true, false, 300, ''),
    ('cp-cap-on-rack', 'Cap On Rack', 'each', null, 'Racks', null, null, 1, true, false, 310, ''),
    ('cp-hind-shanks', 'Hind Shanks', 'each', null, 'Shanks', null, 2, 1, true, false, 400, '2 per pack.'),
    ('cp-labeled-hind-shanks', 'Labeled Hind Shanks', 'each', null, 'Shanks', null, 2, 1, true, false, 410,
     '2 per pack. Each pack weighed and labeled for retail sale.'),
    ('cp-bls-legs', 'BLS Legs', 'each', null, 'Legs and shoulders', null, null, 1, true, false, 500, ''),
    ('cp-bls-shoulder', 'BLS Shoulder', 'each', 'lb', 'Legs and shoulders', null, null, 1, true, false, 510,
     'Ordered in pieces or pounds.'),
    ('cp-stew-meat', 'Stew Meat', 'lb', null, 'Legs and shoulders', null, null, 1, true, false, 520,
     'Comes from shoulders.'),
    ('cp-ground-1', 'Ground Lamb 1 lb', 'pack', null, 'Ground and trim', 1, null, 1, true, false, 600, 'From trim. 1 lb packs.'),
    ('cp-ground-5', 'Ground Lamb 5 lb', 'pack', 'lb', 'Ground and trim', 5, null, 1, true, false, 610, 'From trim. 5 lb packs.'),
    ('cp-le-trim', 'Le Trim', 'lb', null, 'Ground and trim', null, null, 10, true, false, 620,
     'Ordered in 10 lb steps. Each 10 lb is one pack of trim plus one boneless shoulder (or half a boneless leg). Billed by actual packed weight.'),
    ('cp-denver-ribs', 'Denver Ribs', 'lb', null, 'Byproducts', null, null, 1, true, false, 700, 'A byproduct; does not drive the lamb count.'),
    ('cp-heart', 'Heart', 'pack', null, 'Byproducts', null, 2, 1, true, false, 710, '2 per pack.'),
    ('cp-liver', 'Liver', 'pack', null, 'Byproducts', null, 1, 1, true, false, 720, '1 per pack.'),
    ('cp-kidney', 'Kidney', 'pack', null, 'Byproducts', null, 4, 1, true, false, 730, '4 per pack.'),
    ('cp-necks', 'Necks', 'each', null, 'Byproducts', null, null, 1, true, false, 740, ''),
    ('cp-bones', 'Bones', 'lb', null, 'Byproducts', null, null, 1, true, false, 750, ''),
    ('cp-pet', 'Pet', 'lb', null, 'Byproducts', null, null, 1, true, false, 760, '')
  on conflict (id) do nothing;

  -- Byproducts never drive the count.
  update public.products set counts_toward_lambs = false
  where id in ('cp-denver-ribs', 'cp-heart', 'cp-liver', 'cp-kidney', 'cp-necks', 'cp-bones', 'cp-pet');

  -- Which parts each one uses, per order unit.
  insert into public.product_part_uses (product_id, part_id, qty)
  select v.product_id, v.part_id, v.qty
  from (values
    ('cp-whole-lamb', 'leg', 2), ('cp-whole-lamb', 'shoulder', 2), ('cp-whole-lamb', 'rack', 2),
    ('cp-whole-lamb', 'loin', 2), ('cp-whole-lamb', 'fshank', 2), ('cp-whole-lamb', 'hshank', 2),
    ('cp-whole-lamb', 'neck', 1), ('cp-whole-lamb', 'trim', 5),
    ('cp-chops', 'loin', 0.4),            -- 2.5 lb per short loin
    ('cp-thick-chops', 'loin', 0.4),      -- guess: same as Chops
    ('cp-labeled-chops', 'loin', 0.4),
    ('cp-short-loin', 'loin', 1),
    ('cp-french-rack', 'rack', 1),
    ('cp-cap-on-rack', 'rack', 1),
    ('cp-hind-shanks', 'hshank', 1),
    ('cp-labeled-hind-shanks', 'hshank', 1),
    ('cp-bls-legs', 'leg', 1),
    ('cp-bls-shoulder', 'shoulder', 1),
    ('cp-ground-1', 'trim', 1),
    ('cp-ground-5', 'trim', 5),
    ('cp-le-trim', 'shoulder', 0.1),      -- one boneless shoulder per 10 lb
    ('cp-necks', 'neck', 1)
  ) as v(product_id, part_id, qty)
  where exists (select 1 from public.parts p where p.id = v.part_id)
  on conflict do nothing;

  -- Which Mohawk lines each one comes from (matched by wording, so nothing
  -- breaks if a line was renamed; unmatched ones are left for Kathy to link).
  insert into public.product_cut_specs (product_id, cut_spec_id, units_per_cut)
  select v.product_id, s.id, v.units_per_cut
  from (values
    ('cp-whole-lamb', 'Well finished lamb for Carcass (70-80# Target)', 1),
    ('cp-chops', 'Short Loins to 1 1/4 inch chops 4/pak, sirloins out!', 2.5),
    ('cp-labeled-chops', 'Short Loins to 1 1/4 inch chops 4/pak, sirloins out!', 2.5),
    ('cp-short-loin', 'Shortloins - NSM Spec lean trim::1 PK,', 1),
    ('cp-french-rack', 'French Rack to Vac', 1),
    ('cp-hind-shanks', 'Hind Shanks 2/pack', 1),
    ('cp-labeled-hind-shanks', 'Hind Shanks 2/pack', 1),
    ('cp-bls-legs', 'BLS legs to Vac', 1),
    ('cp-bls-shoulder', 'BLS Shoulder to Vac', 1)
  ) as v(product_id, spec_text, units_per_cut)
  join public.cut_specs s on s.text = v.spec_text
  where exists (select 1 from public.products p where p.id = v.product_id)
  on conflict do nothing;

  update public.app_settings set customer_products_seeded_at = now();
  return 'done';
end;
$$;

revoke execute on function public.seed_customer_products() from public, anon, authenticated;
grant execute on function public.seed_customer_products() to service_role;

select public.seed_customer_products();
