-- Cut sheet: blank lines, and one-time instructions.
--
-- A new line no longer starts with an instruction already chosen: it is blank
-- (kind 'line', no instruction, no text) until Kathy picks one. Blank lines
-- never print.
--
-- A line can also carry one-time wording typed on the set (text, with no
-- cut_spec_id), so it doesn't become a permanent option. use_type says what
-- it counts as when the set is checked (a leg, a shoulder, nothing).

alter table public.cut_set_lines drop constraint if exists cut_set_lines_check;
alter table public.cut_set_lines
  add column use_type text check (use_type in (
    'leg', 'legshank', 'shoulder', 'rack', 'loin', 'wholeloin', 'saddle',
    'fshank', 'hshank', 'allshank', 'carcass', 'none'
  ));

-- A new set starts with no size chosen (it already could be null; the
-- screens now leave it that way).

-- Copy, Undo, and "Put these on this set" carry the one-time wording's type.
CREATE OR REPLACE FUNCTION public.copy_cut_sheet(p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_sets int := 0;
  s record;
  v_new uuid;
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
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

    insert into public.cut_set_lines (set_id, kind, cut_spec_id, use_type, qty, text, side_note, highlight, shank_on, sort)
    select v_new, l.kind, l.cut_spec_id, l.use_type, l.qty, l.text, l.side_note, l.highlight, l.shank_on, l.sort
    from public.cut_set_lines l where l.set_id = s.id;

    insert into public.cut_set_customers (set_id, customer_id)
    select v_new, c.customer_id from public.cut_set_customers c where c.set_id = s.id;

    v_sets := v_sets + 1;
  end loop;

  return v_sets;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_cut_set(p_snap jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  s jsonb := p_snap -> 'set';
  v_id uuid := (s ->> 'id')::uuid;
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
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
  insert into public.cut_set_lines (id, set_id, kind, cut_spec_id, use_type, qty, text, side_note, highlight, shank_on, sort)
  select
    coalesce((l ->> 'id')::uuid, gen_random_uuid()), v_id, l ->> 'kind', l ->> 'cut_spec_id', l ->> 'use_type',
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
$function$;

CREATE OR REPLACE FUNCTION public.fill_cut_set(p_set uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_before jsonb;
  v_week date;
  v_lambs int;
  v_sort int;
  v_added int := 0;
  v_most numeric;
  r record;
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
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
      left join public.cut_specs sp on sp.id = l.cut_spec_id
      cross join lateral public.cut_use_parts(coalesce(sp.use_type, l.use_type), l.shank_on) u
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
$function$;
