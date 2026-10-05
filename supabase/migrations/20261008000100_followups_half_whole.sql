-- Phase 5: follow-ups and half and whole lamb orders.

-- Mark a follow-up done (or not done). Lucas decided any office or admin user
-- may do this, while only the author can edit or delete the entry itself
-- (the contact_log RLS policies). This function changes only follow_up_done,
-- and the audit log records who did it. security definer so it can get past
-- the author-only update policy; it checks the caller's role itself.
create or replace function public.set_follow_up_done(p_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can mark follow-ups.' using errcode = '42501';
  end if;
  update public.contact_log
  set follow_up_done = p_done
  where id = p_id and deleted_at is null;
end;
$$;

-- Save a half or whole order and its choices in one step.
-- p_order: {id?, customer_name, phone, size, status, need_by, notes}
-- p_choices: [{part_id, slot, product_id}]  (replaces all choices)
create or replace function public.save_half_whole(p_order jsonb, p_choices jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_order ->> 'id', '')::uuid;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change half and whole orders.' using errcode = '42501';
  end if;
  if coalesce(trim(p_order ->> 'customer_name'), '') = '' then
    raise exception 'Add the customer''s name.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.half_whole_orders (customer_name, phone, size, status, need_by, notes)
    values (
      trim(p_order ->> 'customer_name'), coalesce(p_order ->> 'phone', ''), p_order ->> 'size',
      coalesce(p_order ->> 'status', 'pending'), nullif(p_order ->> 'need_by', '')::date, coalesce(p_order ->> 'notes', '')
    )
    returning id into v_id;
  else
    update public.half_whole_orders set
      customer_name = trim(p_order ->> 'customer_name'),
      phone = coalesce(p_order ->> 'phone', ''),
      size = p_order ->> 'size',
      status = coalesce(p_order ->> 'status', 'pending'),
      need_by = nullif(p_order ->> 'need_by', '')::date,
      notes = coalesce(p_order ->> 'notes', '')
    where id = v_id;
    if not found then
      raise exception 'That order no longer exists.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.half_whole_choices c
  where c.order_id = v_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) x
      where x ->> 'part_id' = c.part_id and (x ->> 'slot')::int = c.slot
    );

  insert into public.half_whole_choices (order_id, part_id, slot, product_id)
  select v_id, x ->> 'part_id', (x ->> 'slot')::int, nullif(x ->> 'product_id', '')
  from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) x
  on conflict (order_id, part_id, slot) do update
    set product_id = excluded.product_id
    where public.half_whole_choices.product_id is distinct from excluded.product_id;

  return v_id;
end;
$$;

revoke execute on function public.set_follow_up_done(uuid, boolean), public.save_half_whole(jsonb, jsonb) from public, anon;
grant execute on function public.set_follow_up_done(uuid, boolean), public.save_half_whole(jsonb, jsonb) to authenticated, service_role;
