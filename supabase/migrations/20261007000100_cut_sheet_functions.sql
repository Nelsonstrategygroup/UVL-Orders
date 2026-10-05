-- Phase 4: cut sheet functions. Each runs in one transaction and as the
-- caller (security invoker), so Row Level Security still applies.

-- What one unit of each kind of instruction uses (SPEC 6.3). Plain leg lines
-- with "shank on" also use a hind shank. Mirrors USES in lib/calc/cutsheet.ts.
create or replace function public.cut_use_parts(p_use_type text, p_shank_on boolean default false)
returns table (part_id text, mult numeric)
language sql
immutable
set search_path = ''
as $$
  select v.part_id, v.mult
  from (values
    ('leg', 'leg', 1),
    ('legshank', 'leg', 1), ('legshank', 'hshank', 1),
    ('shoulder', 'shoulder', 1),
    ('rack', 'rack', 1),
    ('loin', 'loin', 1),
    ('wholeloin', 'rack', 1), ('wholeloin', 'loin', 1),
    ('saddle', 'loin', 2),
    ('fshank', 'fshank', 1),
    ('hshank', 'hshank', 1),
    ('allshank', 'fshank', 0.5), ('allshank', 'hshank', 0.5),
    ('carcass', 'leg', 2), ('carcass', 'shoulder', 2), ('carcass', 'rack', 2),
    ('carcass', 'loin', 2), ('carcass', 'fshank', 2), ('carcass', 'hshank', 2)
  ) as v(use_type, part_id, mult)
  where v.use_type = p_use_type
  union all
  select 'hshank', 1::numeric where p_use_type = 'leg' and p_shank_on;
$$;

-- Everything about one set, for Undo.
create or replace function public.cut_set_snapshot(p_set uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'set', to_jsonb(s) - 'created_at' - 'updated_at',
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) - 'created_at' - 'updated_at' order by l.sort)
      from public.cut_set_lines l where l.set_id = s.id), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(c.customer_id) from public.cut_set_customers c where c.set_id = s.id), '[]'::jsonb)
  )
  from public.cut_sets s
  where s.id = p_set;
$$;

-- Put a set back exactly as a snapshot had it (Undo for delete, fill, and line delete).
-- Recreates the set if it was deleted.
create or replace function public.restore_cut_set(p_snap jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s jsonb := p_snap -> 'set';
  v_id uuid := (s ->> 'id')::uuid;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change the cut sheet.' using errcode = '42501';
  end if;

  insert into public.cut_sets (id, week_id, name, lambs, size_class_id, headline, sort, filled_week)
  values (
    v_id, (s ->> 'week_id')::date, coalesce(s ->> 'name', ''), coalesce((s ->> 'lambs')::int, 0),
    s ->> 'size_class_id', coalesce(s ->> 'headline', ''), coalesce((s ->> 'sort')::int, 0),
    (s ->> 'filled_week')::date
  )
  on conflict (id) do update set
    name = excluded.name, lambs = excluded.lambs, size_class_id = excluded.size_class_id,
    headline = excluded.headline, sort = excluded.sort, filled_week = excluded.filled_week;

  delete from public.cut_set_lines where set_id = v_id;
  insert into public.cut_set_lines (id, set_id, kind, cut_spec_id, qty, text, side_note, highlight, shank_on, sort)
  select
    coalesce((l ->> 'id')::uuid, gen_random_uuid()), v_id, l ->> 'kind', l ->> 'cut_spec_id',
    (l ->> 'qty')::numeric, l ->> 'text', coalesce(l ->> 'side_note', ''), l ->> 'highlight',
    coalesce((l ->> 'shank_on')::boolean, false), coalesce((l ->> 'sort')::int, 0)
  from jsonb_array_elements(coalesce(p_snap -> 'lines', '[]'::jsonb)) l;

  delete from public.cut_set_customers where set_id = v_id;
  insert into public.cut_set_customers (set_id, customer_id)
  select v_id, c::uuid
  from jsonb_array_elements_text(coalesce(p_snap -> 'customers', '[]'::jsonb)) c
  where exists (select 1 from public.customers x where x.id = c::uuid);

  return v_id;
end;
$$;

-- "Put these on this set" (SPEC 6.4). Adds the linked customers' order lines
-- for the set's week: each product with a cut spec adds its quantity to the
-- set's line with that spec, or a new line at the end. If the set has 0
-- lambs, it becomes ceil(most of any balance part used / 2). Returns how many
-- products were added and a snapshot of the set from before, for Undo.
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
    select p.cut_spec_id, sum(l.qty) as qty
    from public.cut_set_customers c
    join public.orders o on o.customer_id = c.customer_id and o.week_id = v_week
    join public.order_lines l on l.order_id = o.id
    join public.products p on p.id = l.product_id
    where c.set_id = p_set and p.cut_spec_id is not null
    group by p.cut_spec_id
    order by min(p.sort)
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

-- "Copy the week of ..." (SPEC 5.5): duplicates banners, sets, lines, and set
-- customers. Clears INV#, pulled counts, and sent fields.
create or replace function public.copy_cut_sheet(p_from date, p_to date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sets int := 0;
  s record;
  v_new uuid;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change the cut sheet.' using errcode = '42501';
  end if;
  if exists (select 1 from public.cut_sheets where week_id = p_to) then
    raise exception 'This week already has a cut sheet.' using errcode = '23505';
  end if;

  insert into public.weeks (id) values (p_to) on conflict (id) do nothing;
  insert into public.cut_sheets (week_id, notes)
  select p_to, c.notes from public.cut_sheets c where c.week_id = p_from;
  if not found then
    raise exception 'There is no cut sheet to copy from that week.' using errcode = 'P0002';
  end if;

  insert into public.cut_sheet_banners (week_id, text, sort)
  select p_to, b.text, b.sort from public.cut_sheet_banners b where b.week_id = p_from;

  for s in select * from public.cut_sets where week_id = p_from order by sort loop
    insert into public.cut_sets (week_id, name, lambs, size_class_id, headline, sort)
    values (p_to, s.name, s.lambs, s.size_class_id, s.headline, s.sort)
    returning id into v_new;

    insert into public.cut_set_lines (set_id, kind, cut_spec_id, qty, text, side_note, highlight, shank_on, sort)
    select v_new, l.kind, l.cut_spec_id, l.qty, l.text, l.side_note, l.highlight, l.shank_on, l.sort
    from public.cut_set_lines l where l.set_id = s.id;

    insert into public.cut_set_customers (set_id, customer_id)
    select v_new, c.customer_id from public.cut_set_customers c where c.set_id = s.id;

    v_sets := v_sets + 1;
  end loop;

  return v_sets;
end;
$$;

-- "Start a blank sheet": the sheet and one empty set.
create or replace function public.start_cut_sheet(p_week date, p_size text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change the cut sheet.' using errcode = '42501';
  end if;
  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  insert into public.cut_sheets (week_id) values (p_week);
  insert into public.cut_sets (week_id, size_class_id, sort) values (p_week, p_size, 0);
end;
$$;

-- Undo for copying or starting a sheet: removes this week's sheet and
-- everything on it. Only allowed while it has not been sent.
create or replace function public.remove_unsent_cut_sheet(p_week date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change the cut sheet.' using errcode = '42501';
  end if;
  delete from public.cut_sheets where week_id = p_week and sent_at is null;
end;
$$;

-- "Add a new instruction..." (SPEC 4.2): a new cut spec and a matching
-- product with the same text, linked to it, with part uses from its type.
create or replace function public.add_cut_spec(p_text text, p_use_type text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_spec text;
  v_product text;
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

  insert into public.products (name, short_name, unit, group_name, cut_spec_id, sort)
  values (
    v_text,
    case when length(v_text) > 22 then left(v_text, 20) || '...' else v_text end,
    case when p_use_type = 'carcass' then 'lamb' else 'each' end,
    case p_use_type
      when 'leg' then 'Legs' when 'legshank' then 'Legs'
      when 'shoulder' then 'Shoulders' when 'rack' then 'Racks'
      when 'loin' then 'Loins' when 'wholeloin' then 'Loins' when 'saddle' then 'Loins'
      when 'fshank' then 'Shanks' when 'hshank' then 'Shanks' when 'allshank' then 'Shanks'
      when 'carcass' then 'Whole lambs' else 'Other' end,
    v_spec,
    (select coalesce(max(sort), -1) + 1 from public.products)
  )
  returning id into v_product;

  -- A whole lamb uses one lamb's worth of every part; other types use what 6.3 says.
  if p_use_type = 'carcass' then
    insert into public.product_part_uses (product_id, part_id, qty)
    select v_product, p.id, p.per_lamb from public.parts p where p.per_lamb > 0;
  else
    insert into public.product_part_uses (product_id, part_id, qty)
    select v_product, u.part_id, u.mult from public.cut_use_parts(p_use_type, false) u;
  end if;

  return v_spec;
end;
$$;

-- Mark the sheet sent (printing, emailing, or "I sent it another way").
-- The hash is of the plain-text sheet, so later changes can be noticed.
create or replace function public.mark_cut_sheet_sent(p_week date, p_hash text)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can send the cut sheet.' using errcode = '42501';
  end if;
  update public.cut_sheets set sent_at = v_at, sent_hash = p_hash, sent_by = auth.uid() where week_id = p_week;
  return v_at;
end;
$$;

revoke execute on function
  public.cut_set_snapshot(uuid), public.restore_cut_set(jsonb), public.fill_cut_set(uuid),
  public.copy_cut_sheet(date, date), public.start_cut_sheet(date, text), public.remove_unsent_cut_sheet(date),
  public.add_cut_spec(text, text), public.mark_cut_sheet_sent(date, text)
from public, anon;
grant execute on function
  public.cut_set_snapshot(uuid), public.restore_cut_set(jsonb), public.fill_cut_set(uuid),
  public.copy_cut_sheet(date, date), public.start_cut_sheet(date, text), public.remove_unsent_cut_sheet(date),
  public.add_cut_spec(text, text), public.mark_cut_sheet_sent(date, text), public.cut_use_parts(text, boolean)
to authenticated, service_role;
