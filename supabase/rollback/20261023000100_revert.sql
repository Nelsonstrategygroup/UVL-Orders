-- Undo 20261023000100_requested_lines.sql: removes requested lines (any still
-- waiting are lost, so confirm or note them first) and puts "Put these on
-- this set" back to orders only.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261023000100_revert.sql

begin;

alter publication supabase_realtime drop table public.order_requests;
drop function if exists public.confirm_request(uuid, numeric);
drop function if exists public.request_line(date, uuid, text, numeric, text);
drop function if exists public.undo_move_line(uuid);
drop function if exists public.move_line_to_next_week(date, uuid, text);
drop function if exists public.add_to_order(date, uuid, text, numeric, text);
drop table if exists public.order_requests;

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

delete from supabase_migrations.schema_migrations where version = '20261023000100';

commit;
