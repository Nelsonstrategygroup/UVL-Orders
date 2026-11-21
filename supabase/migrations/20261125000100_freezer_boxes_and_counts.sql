-- Freezer boxes, take-outs, counts and the freezer value (Lucas, 11/19-20/26).
--
-- Until now the freezer was only a count per product (freezer_log). This adds
-- a record of each box put in the freezer (scanned or typed), so the app can
-- tell a box that's already there, list what wasn't counted, and value what
-- went in. Every box still writes its +qty line to freezer_log, and every
-- take-out its -qty line, so On hand, Half and whole and "Add or take out"
-- work exactly as before.
--
--   freezer_value_rates   "Freezer value: percent of default sale price", from
--                         a date on (90% from 2026-10-08). Admin only.
--   freezer_boxes         One box (or a typed-in lot of pieces) put in the
--                         freezer: product, count, weight, label details,
--                         why, when, and the week it counts toward.
--   freezer_box_values    What a box was worth going in: default sale price
--                         on the day x percent x weight (or count). Kept apart
--                         so only admins (and the P&L) can read the dollars.
--   freezer_takes         What came out of a box: packed for an order, a half
--                         or whole order, or taken out with a reason.
--   freezer_counts        A freezer count: stock-in (scan to add everything)
--                         or reconciliation; open, applied or thrown away; the
--                         results kept when applied.
--   freezer_count_items   Each box scanned (or counted by hand) in a count.
--                         Nothing changes in inventory until the count is applied.
--   freezer_count_devices Each phone in a count and how many scans it still
--                         has to upload, so a count is applied only when all
--                         are in (or an admin applies it anyway).
--
-- Rules:
--   * A box with the same GTIN and serial can't be in the freezer twice.
--   * A box packed for a customer (packing_weights) isn't added to the freezer.
--   * When a box in the freezer is packed for an order (same GTIN and serial),
--     it comes out of the freezer by itself.
--   * Only a leftover put away from Packing counts as that week's freezer
--     income by itself; any other add counts only if an admin says so.
--   * A box or take-out that counts in a closed week's P&L can't change.
--   * The packing role can now add to the freezer and run counts (freezer:
--     Change), as Lucas asked; admins and Operations leads already could.
--
-- Undo: supabase/rollback/20261125000100_revert.sql

-- ---------------------------------------------------------------------------
-- The freezer value setting
-- ---------------------------------------------------------------------------
create table public.freezer_value_rates (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  percent numeric not null check (percent >= 0 and percent <= 100),
  note text not null default '',
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.freezer_value_rates is
  'Freezer value: percent of the default sale price product put in the freezer counts at (Kathy''s rule: 90%), from effective_from on. The newest on or before a box''s date applies.';

insert into public.freezer_value_rates (effective_from, percent, note)
values ('2026-10-08', 90, 'Kathy''s rule: some freezer product never sells at full price.');

create trigger freezer_value_rates_updated_at before update on public.freezer_value_rates
  for each row execute function public.set_updated_at();
create trigger freezer_value_rates_audit after insert or update or delete on public.freezer_value_rates
  for each row execute function public.audit_row();

alter table public.freezer_value_rates enable row level security;
create policy "freezer_value_rates: read" on public.freezer_value_rates for select to authenticated
  using ((select public.is_admin()) or (select public.can_view('pnl')));
create policy "freezer_value_rates: admin" on public.freezer_value_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Counts (made before boxes: a box can come from a count)
-- ---------------------------------------------------------------------------
create table public.freezer_counts (
  -- Made on the phone, so a count can start with no signal.
  id uuid primary key,
  kind text not null check (kind in ('stock_in', 'reconcile')),
  -- Null: the whole freezer. Otherwise only these products.
  product_ids text[],
  status text not null default 'open' check (status in ('open', 'applied', 'discarded')),
  count_date date not null default ((now() at time zone 'America/Los_Angeles')::date),
  note text not null default '',
  started_by uuid default auth.uid() references public.profiles (id),
  started_at timestamptz not null default now(),
  applied_by uuid,
  applied_at timestamptz,
  discarded_by uuid,
  discarded_at timestamptz,
  -- Applied: what the review showed (by product: app, counted, difference; matched, found, not counted; what was done).
  results jsonb,
  -- Applied while phones still had scans waiting (admin only).
  applied_anyway boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.freezer_counts is
  'A freezer count: stock_in (scan to add everything) or reconcile (compare with the app). Nothing changes in inventory until apply_freezer_count. applied_by/discarded_by are profiles ids (no foreign key on purpose).';
-- One open count at a time; any number of phones can join it.
create unique index freezer_counts_one_open on public.freezer_counts ((true)) where status = 'open';

create table public.freezer_count_items (
  -- Made on the phone (sending twice saves once).
  id uuid primary key,
  count_id uuid not null references public.freezer_counts (id) on delete cascade,
  device_id text not null default '',
  kind text not null check (kind in ('scan', 'manual')),
  product_id text references public.products (id) on delete restrict,
  qty numeric not null check (qty > 0),
  weight_lb numeric check (weight_lb is null or weight_lb > 0),
  gtin text check (gtin is null or gtin ~ '^[0-9]{14}$'),
  serial text,
  serial_date date,
  case_no text,
  pack_date date,
  lot text,
  raw_scan text,
  -- False: a non-admin picked the product for a label the app doesn't know yet.
  product_confirmed boolean not null default true,
  -- Reconcile: add a box that isn't in the app (decided during the count or on review). Stock-in: skip to leave one out.
  decision text check (decision is null or decision in ('add', 'skip')),
  -- A scan taken back during the count.
  voided boolean not null default false,
  scanned_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint freezer_count_items_product check (kind = 'scan' or product_id is not null)
);
create index freezer_count_items_count on public.freezer_count_items (count_id);
-- The same box counted twice (two phones) is kept once.
create unique index freezer_count_items_box on public.freezer_count_items (count_id, gtin, serial)
  where serial is not null and not voided;

create table public.freezer_count_devices (
  count_id uuid not null references public.freezer_counts (id) on delete cascade,
  device_id text not null,
  person_name text not null default '',
  user_id uuid default auth.uid(),
  -- Scans still on that phone when it last reported.
  waiting int not null default 0 check (waiting >= 0),
  last_seen timestamptz not null default now(),
  primary key (count_id, device_id)
);

-- ---------------------------------------------------------------------------
-- Boxes in the freezer
-- ---------------------------------------------------------------------------
create table public.freezer_boxes (
  id uuid primary key default gen_random_uuid(),
  -- Made on the phone (sending twice saves once).
  client_id uuid unique,
  product_id text not null references public.products (id) on delete restrict,
  -- In the product's own unit (pieces, packs or pounds).
  qty numeric not null check (qty > 0),
  -- What's still in the freezer (qty less take-outs). Kept by the take-out triggers.
  qty_left numeric not null default 0 check (qty_left >= 0),
  weight_lb numeric check (weight_lb is null or weight_lb > 0),
  gtin text check (gtin is null or gtin ~ '^[0-9]{14}$'),
  serial text,
  serial_date date,
  case_no text,
  pack_date date,
  lot text,
  raw_scan text,
  product_confirmed boolean not null default true,
  source text not null check (source in ('manual', 'scan', 'packing', 'count')),
  reason text not null default 'added_manually'
    check (reason in ('added_manually', 'found', 'put_away', 'leftover', 'stock_in', 'other')),
  note text not null default '',
  added_on date not null default ((now() at time zone 'America/Los_Angeles')::date),
  -- The order week it counts toward: a packing leftover's packing week, else the week holding added_on.
  week_id date not null,
  counts_as_income boolean not null default false,
  count_id uuid references public.freezer_counts (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint freezer_boxes_other_note check (reason <> 'other' or btrim(note) <> '')
);
comment on table public.freezer_boxes is
  'A box (or typed-in amount) put in the freezer outside an order. Writes its +qty to freezer_log. counts_as_income: Into freezer income on the Weekly P&L for week_id (packing leftovers by themselves; others only when an admin says so).';
create index freezer_boxes_product on public.freezer_boxes (product_id);
create index freezer_boxes_week on public.freezer_boxes (week_id);
create unique index freezer_boxes_in_once on public.freezer_boxes (gtin, serial)
  where serial is not null and gtin is not null and qty_left > 0;

create table public.freezer_box_values (
  box_id uuid primary key references public.freezer_boxes (id) on delete cascade,
  priced_on date not null,
  -- The product whose default price was used (the group's for products packed together).
  price_product_id text,
  price numeric,
  price_unit text,
  percent numeric,
  -- Rounded to the cent. Null: no value, and note says why.
  value numeric,
  note text not null default ''
);
comment on table public.freezer_box_values is
  'What a freezer box was worth going in (set by trigger, never typed): default sale price on added_on x freezer value percent x weight (lb price) or count (case or each price). Read by admins and the P&L only.';

create table public.freezer_takes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  box_id uuid not null references public.freezer_boxes (id) on delete cascade,
  qty numeric not null check (qty > 0),
  taken_on date not null default ((now() at time zone 'America/Los_Angeles')::date),
  week_id date not null,
  reason text not null check (reason in ('packed', 'half_whole', 'taken_out', 'sold', 'used', 'discarded', 'not_found', 'other')),
  note text not null default '',
  packing_weight_id uuid unique references public.packing_weights (id) on delete cascade,
  half_whole_order_id uuid references public.half_whole_orders (id) on delete cascade,
  count_id uuid references public.freezer_counts (id) on delete set null,
  -- A count-based take-out (Half and whole filled, "Add or take out") that took this from the oldest box.
  -- No foreign key on purpose: freezer_log already points here (freezer_take_id), and a second link
  -- between the two tables breaks the API's embeds. Removed with its log line by trigger.
  source_log_id uuid,
  -- Out of freezer on the P&L: takes back what the box added going in.
  counts_in_pnl boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint freezer_takes_other_note check (reason <> 'other' or btrim(note) <> '')
);
comment on table public.freezer_takes is
  'Something taken out of a freezer box. Writes its -qty to freezer_log (except half and whole orders, which log their own). counts_in_pnl: Out of freezer on the P&L for week_id, at the value the box went in at.';
create index freezer_takes_box on public.freezer_takes (box_id);
create index freezer_takes_week on public.freezer_takes (week_id);

-- The freezer log lines a box or take-out wrote.
alter table public.freezer_log
  add column freezer_box_id uuid references public.freezer_boxes (id) on delete cascade,
  add column freezer_take_id uuid references public.freezer_takes (id) on delete cascade;
create index freezer_log_box_idx on public.freezer_log (freezer_box_id) where freezer_box_id is not null;
create index freezer_log_take_idx on public.freezer_log (freezer_take_id) where freezer_take_id is not null;

-- ---------------------------------------------------------------------------
-- The value of a box going in
-- ---------------------------------------------------------------------------
create or replace function public.freezer_value(p_product text, p_qty numeric, p_weight numeric, p_date date)
returns table (price_product_id text, price numeric, price_unit text, percent numeric, value numeric, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead text := public.pack_group_product(p_product);
  v_unit text;
  v_price numeric;
  v_pct numeric;
  v_amount numeric;
begin
  select p.price_unit into v_unit from public.products p where p.id = v_lead;
  select pr.price into v_price from public.prices pr
    where pr.product_id = v_lead and pr.customer_id is null and pr.effective_from <= p_date
    order by pr.effective_from desc limit 1;
  select r.percent into v_pct from public.freezer_value_rates r
    where r.effective_from <= p_date order by r.effective_from desc limit 1;
  price_product_id := v_lead; price := v_price; price_unit := v_unit; percent := v_pct; value := null;
  if v_price is null then
    note := 'No freezer value: no default price';
  elsif v_pct is null then
    note := 'No freezer value: no percent set in P&L Setup';
  elsif v_unit = 'lb' and coalesce(p_weight, 0) <= 0 then
    note := 'No freezer value: no weight';
  else
    v_amount := case when v_unit = 'lb' then p_weight else p_qty end;
    -- Half up to the cent, like an invoice line.
    value := round(v_amount * v_price * v_pct / 100, 2);
    note := '';
  end if;
  return next;
end $$;
revoke execute on function public.freezer_value(text, numeric, numeric, date) from public, anon;
grant execute on function public.freezer_value(text, numeric, numeric, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.freezer_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- A box: its week, who may count it as income, the closed-week rule.
create or replace function public.freezer_boxes_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_week date;
begin
  if tg_op = 'INSERT' then
    new.qty_left := new.qty;
    if new.source <> 'packing' or new.week_id is null then
      new.week_id := public.order_week(new.added_on);
    end if;
    -- A leftover from Packing counts by itself; anything else only if an admin says so.
    if new.source = 'packing' then
      new.counts_as_income := true;
    elsif new.counts_as_income and not public.is_admin() then
      new.counts_as_income := false;
    end if;
  else
    if new.added_on is distinct from old.added_on and new.source <> 'packing' then
      new.week_id := public.order_week(new.added_on);
    end if;
    if new.counts_as_income is distinct from old.counts_as_income and not public.is_admin()
      and coalesce(current_setting('uvl.freezer_sync', true), '') <> 'on' then
      raise exception 'Only an admin can change whether this counts as freezer income.' using errcode = '42501';
    end if;
    if new.qty is distinct from old.qty then
      new.qty_left := new.qty - coalesce((select sum(t.qty) from public.freezer_takes t where t.box_id = new.id), 0);
      if new.qty_left < 0 then
        raise exception 'More has been taken out of this box than that.';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.freezer_boxes_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v_week date; v_prev text := coalesce(current_setting('uvl.freezer_sync', true), '');
begin
  -- A box that counts in a closed week's P&L can't change (before or after).
  foreach v_week in array array[
    case when tg_op <> 'INSERT' and old.counts_as_income then old.week_id end,
    case when tg_op <> 'DELETE' and new.counts_as_income then new.week_id end
  ] loop
    if v_week is not null and public.week_is_closed(v_week)
      and (tg_op <> 'UPDATE' or (to_jsonb(new) - 'qty_left' - 'updated_at') <> (to_jsonb(old) - 'qty_left' - 'updated_at')) then
      raise exception 'The week of % is closed on the Weekly P&L. Reopen it there to make changes.',
        to_char(v_week, 'FMMon FMDD, YYYY') using errcode = '55000';
    end if;
  end loop;

  perform set_config('uvl.freezer_sync', 'on', true);
  if tg_op = 'INSERT' then
    insert into public.freezer_log (entry_date, product_id, qty, note, freezer_box_id, created_by)
    values (new.added_on, new.product_id, new.qty,
      case new.reason
        when 'leftover' then 'Leftover from packing'
        when 'found' then 'Found in freezer'
        when 'put_away' then 'Put away outside packing'
        when 'stock_in' then 'Freezer stock-in count'
        when 'other' then new.note
        else 'Added manually' end
      || case when new.reason <> 'other' and btrim(new.note) <> '' then ': ' || new.note else '' end,
      new.id, new.created_by);
  elsif tg_op = 'UPDATE' and (new.product_id, new.qty, new.added_on) is distinct from (old.product_id, old.qty, old.added_on) then
    update public.freezer_log set product_id = new.product_id, qty = new.qty, entry_date = new.added_on
    where freezer_box_id = new.id;
    -- A take-out's log line follows the box's product.
    update public.freezer_log l set product_id = new.product_id
    from public.freezer_takes t where t.box_id = new.id and l.freezer_take_id = t.id;
  end if;

  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and (new.product_id, new.qty, new.weight_lb, new.added_on) is distinct from (old.product_id, old.qty, old.weight_lb, old.added_on)) then
    select * into r from public.freezer_value(new.product_id, new.qty, new.weight_lb, new.added_on);
    insert into public.freezer_box_values (box_id, priced_on, price_product_id, price, price_unit, percent, value, note)
    values (new.id, new.added_on, r.price_product_id, r.price, r.price_unit, r.percent, r.value, r.note)
    on conflict (box_id) do update set priced_on = excluded.priced_on, price_product_id = excluded.price_product_id,
      price = excluded.price, price_unit = excluded.price_unit, percent = excluded.percent, value = excluded.value, note = excluded.note;
  end if;
  -- Put back what an outer trigger had (they nest).
  perform set_config('uvl.freezer_sync', v_prev, true);
  return null;
end $$;

create trigger freezer_boxes_before before insert or update on public.freezer_boxes
  for each row execute function public.freezer_boxes_before();
create trigger freezer_boxes_updated_at before update on public.freezer_boxes
  for each row execute function public.set_updated_at();
create trigger freezer_boxes_after after insert or update or delete on public.freezer_boxes
  for each row execute function public.freezer_boxes_after();
create trigger freezer_boxes_audit after insert or update or delete on public.freezer_boxes
  for each row execute function public.audit_row();

-- A take-out: never more than is left; its week; whether it counts on the P&L.
create or replace function public.freezer_takes_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare b record;
begin
  if tg_op = 'UPDATE' and (new.box_id, new.qty) is distinct from (old.box_id, old.qty) then
    raise exception 'A take-out can''t be changed. Remove it and take out again.';
  end if;
  if tg_op = 'INSERT' then
    select * into b from public.freezer_boxes where id = new.box_id for update;
    if new.qty > b.qty_left then
      raise exception 'Only % left in that box.', trim(to_char(b.qty_left, 'FM999990.##')) using errcode = '23514';
    end if;
    if new.week_id is null then
      new.week_id := public.order_week(new.taken_on);
    end if;
    -- Packed for an order or a half or whole order: takes back what the box added, if it counted.
    if new.reason in ('packed', 'half_whole') then
      new.counts_in_pnl := b.counts_as_income;
    elsif new.counts_in_pnl and not (public.is_admin() and b.counts_as_income) then
      new.counts_in_pnl := false;
    end if;
  end if;
  return new;
end $$;

create or replace function public.freezer_takes_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_week date; v_box uuid := coalesce(new.box_id, old.box_id); v_prev text := coalesce(current_setting('uvl.freezer_sync', true), '');
begin
  foreach v_week in array array[
    case when tg_op <> 'INSERT' and old.counts_in_pnl then old.week_id end,
    case when tg_op <> 'DELETE' and new.counts_in_pnl then new.week_id end
  ] loop
    if v_week is not null and public.week_is_closed(v_week) then
      raise exception 'The week of % is closed on the Weekly P&L. Reopen it there to make changes.',
        to_char(v_week, 'FMMon FMDD, YYYY') using errcode = '55000';
    end if;
  end loop;

  perform set_config('uvl.freezer_sync', 'on', true);
  update public.freezer_boxes b
  set qty_left = b.qty - coalesce((select sum(t.qty) from public.freezer_takes t where t.box_id = b.id), 0)
  where b.id = v_box;
  -- Half and whole orders log their own take-outs (set_half_whole_status), and a take-out
  -- made from a count-based log line already has that line.
  if tg_op = 'INSERT' and new.reason <> 'half_whole' and new.source_log_id is null then
    insert into public.freezer_log (entry_date, product_id, qty, note, freezer_take_id, created_by)
    select new.taken_on, b.product_id, -new.qty,
      case new.reason
        when 'packed' then 'Packed for an order'
        when 'sold' then 'Sold'
        when 'used' then 'Used'
        when 'discarded' then 'Discarded'
        when 'not_found' then 'Not found in a freezer count'
        when 'other' then new.note
        else 'Taken out' end
      || case when new.reason <> 'other' and btrim(new.note) <> '' then ': ' || new.note else '' end,
      new.id, new.created_by
    from public.freezer_boxes b where b.id = new.box_id;
  end if;
  -- Put back what an outer trigger had (they nest).
  perform set_config('uvl.freezer_sync', v_prev, true);
  return null;
end $$;

create trigger freezer_takes_before before insert or update on public.freezer_takes
  for each row execute function public.freezer_takes_before();
create trigger freezer_takes_updated_at before update on public.freezer_takes
  for each row execute function public.set_updated_at();
create trigger freezer_takes_after after insert or update or delete on public.freezer_takes
  for each row execute function public.freezer_takes_after();
create trigger freezer_takes_audit after insert or update or delete on public.freezer_takes
  for each row execute function public.audit_row();

-- A freezer log line a box or take-out wrote changes only with it.
create or replace function public.freezer_log_box_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('uvl.freezer_sync', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.freezer_box_id is not null or new.freezer_take_id is not null then
      raise exception 'Add boxes with Add to freezer.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Removed with its box or take-out (cascade): the parent is gone already.
  if tg_op = 'DELETE'
    and (old.freezer_box_id is null or not exists (select 1 from public.freezer_boxes where id = old.freezer_box_id))
    and (old.freezer_take_id is null or not exists (select 1 from public.freezer_takes where id = old.freezer_take_id)) then
    return old;
  end if;
  if old.freezer_box_id is not null or old.freezer_take_id is not null
    or (tg_op = 'UPDATE' and (new.freezer_box_id is not null or new.freezer_take_id is not null)) then
    raise exception 'This line belongs to a freezer box. Change the box instead.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger freezer_log_box_guard before insert or update or delete on public.freezer_log
  for each row execute function public.freezer_log_box_guard();

-- Something taken out by count, not by box (Half and whole marked filled, or
-- "Add or take out"): it comes out of the oldest boxes of that product first,
-- so their values leave the freezer too (Lucas, 11/20/26). Whatever no box
-- covers was stock counted before boxes were recorded. Removing the log line
-- (an order put back to pending, or Remove) puts the boxes back.
create or replace function public.freezer_log_takes_oldest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left numeric;
  b record;
  v_take numeric;
  v_week date;
begin
  if tg_op = 'DELETE' then
    delete from public.freezer_takes where source_log_id = old.id;
    return old;
  end if;
  if new.qty >= 0 or new.freezer_box_id is not null or new.freezer_take_id is not null then
    return null;
  end if;
  v_left := -new.qty;
  if new.half_whole_order_id is not null then
    v_week := public.order_week(new.entry_date);
  end if;
  for b in
    select id, qty_left from public.freezer_boxes
    where product_id = new.product_id and qty_left > 0
    order by added_on, created_at, id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, b.qty_left);
    insert into public.freezer_takes (box_id, qty, taken_on, week_id, reason, note, half_whole_order_id, source_log_id, created_by)
    values (b.id, v_take, new.entry_date, coalesce(v_week, public.order_week(new.entry_date)),
      case when new.half_whole_order_id is not null then 'half_whole' else 'taken_out' end,
      left(coalesce(new.note, ''), 200), new.half_whole_order_id, new.id, new.created_by);
    v_left := v_left - v_take;
  end loop;
  return null;
end $$;
create trigger freezer_log_takes_oldest after insert on public.freezer_log
  for each row execute function public.freezer_log_takes_oldest();
create trigger freezer_log_takes_back before delete on public.freezer_log
  for each row execute function public.freezer_log_takes_oldest();

-- A box in the freezer packed for an order (same GTIN and serial) comes out by itself.
create or replace function public.freezer_box_packed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_box record; v_week date;
begin
  if new.order_id is null or new.gtin is null or new.serial is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.order_id is not null and (new.gtin, new.serial) is not distinct from (old.gtin, old.serial) then
    return null;
  end if;
  if exists (select 1 from public.freezer_takes where packing_weight_id = new.id) then
    return null;
  end if;
  select * into v_box from public.freezer_boxes
    where gtin = new.gtin and serial = new.serial and qty_left > 0
    limit 1;
  if not found then
    return null;
  end if;
  select o.week_id into v_week from public.orders o where o.id = new.order_id;
  insert into public.freezer_takes (box_id, qty, taken_on, week_id, reason, packing_weight_id, created_by)
  values (v_box.id, v_box.qty_left, coalesce((new.scanned_at at time zone 'America/Los_Angeles')::date, public.freezer_today()),
    v_week, 'packed', new.id, auth.uid());
  return null;
end $$;
create trigger packing_weights_freezer_box after insert or update of order_id, gtin, serial on public.packing_weights
  for each row execute function public.freezer_box_packed();

-- Counts: items only while the count is open.
create or replace function public.freezer_count_items_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('uvl.freezer_sync', true), '') <> 'on'
    and not exists (select 1 from public.freezer_counts where id = coalesce(new.count_id, old.count_id) and status = 'open') then
    raise exception 'This count is finished. Start a new count to keep counting.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;
create trigger freezer_count_items_open before insert or update or delete on public.freezer_count_items
  for each row execute function public.freezer_count_items_open();

create trigger freezer_counts_updated_at before update on public.freezer_counts
  for each row execute function public.set_updated_at();
create trigger freezer_counts_audit after insert or update or delete on public.freezer_counts
  for each row execute function public.audit_row();
create trigger freezer_count_items_updated_at before update on public.freezer_count_items
  for each row execute function public.set_updated_at();
create trigger freezer_count_items_audit after insert or update or delete on public.freezer_count_items
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Adding, taking out, applying a count (the only ways boxes change)
-- ---------------------------------------------------------------------------

-- Add one box (or typed-in amount). p: product_id, qty, weight_lb, gtin, serial,
-- serial_date, case_no, pack_date, lot, raw_scan, product_confirmed, source,
-- reason, note, added_on, week_id (packing only), counts_as_income, client_id, count_id.
-- Sending the same client_id twice saves it once.
create or replace function public.add_to_freezer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_client uuid := nullif(p ->> 'client_id', '')::uuid;
  v_source text := coalesce(nullif(p ->> 'source', ''), 'manual');
  v_gtin text := nullif(p ->> 'gtin', '');
  v_serial text := nullif(p ->> 'serial', '');
  v_who text;
begin
  if v_source = 'packing' then
    if not (public.can_change('packing') or public.can_change('freezer')) then
      raise exception 'You can''t put boxes in the freezer.' using errcode = '42501';
    end if;
  elsif not public.can_change('freezer') then
    raise exception 'You can''t add to the freezer.' using errcode = '42501';
  end if;
  if v_client is not null then
    select id into v_id from public.freezer_boxes where client_id = v_client;
    if found then return v_id; end if;
  end if;
  if v_serial is not null and v_gtin is not null then
    if exists (select 1 from public.freezer_boxes where gtin = v_gtin and serial = v_serial and qty_left > 0) then
      raise exception 'This box is already in the freezer.' using errcode = '23505';
    end if;
    select coalesce(c.name, 'a customer') into v_who
    from public.packing_weights w join public.orders o on o.id = w.order_id
    left join public.customers c on c.id = o.customer_id
    where w.gtin = v_gtin and w.serial = v_serial
    order by o.week_id desc limit 1;
    if v_who is not null then
      raise exception 'This box is packed for %. It wasn''t added.', v_who using errcode = '23505';
    end if;
  end if;
  insert into public.freezer_boxes (client_id, product_id, qty, weight_lb, gtin, serial, serial_date, case_no,
    pack_date, lot, raw_scan, product_confirmed, source, reason, note, added_on, week_id, counts_as_income, count_id)
  values (v_client, p ->> 'product_id', (p ->> 'qty')::numeric, nullif(p ->> 'weight_lb', '')::numeric, v_gtin, v_serial,
    nullif(p ->> 'serial_date', '')::date, nullif(p ->> 'case_no', ''), nullif(p ->> 'pack_date', '')::date,
    nullif(p ->> 'lot', ''), nullif(p ->> 'raw_scan', ''), coalesce((p ->> 'product_confirmed')::boolean, true),
    v_source, coalesce(nullif(p ->> 'reason', ''), case when v_source = 'packing' then 'leftover' else 'added_manually' end),
    coalesce(p ->> 'note', ''), coalesce(nullif(p ->> 'added_on', '')::date, public.freezer_today()),
    nullif(p ->> 'week_id', '')::date, coalesce((p ->> 'counts_as_income')::boolean, false),
    nullif(p ->> 'count_id', '')::uuid)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_to_freezer(jsonb) from public, anon;
grant execute on function public.add_to_freezer(jsonb) to authenticated, service_role;

-- Packing: a leftover box with no store goes in the freezer (Lucas, 11/20/26).
-- In one step: the freezer box is made from the Packing box (label, lot,
-- weight, pack date) and the Packing box is removed, so it's never in both or
-- neither. Counts as that packing week's freezer income. p: weight_id or
-- weight_client_id (the Packing box), client_id (the freezer box, made on the
-- phone), qty (in the product's unit), note.
create or replace function public.put_box_in_freezer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_id uuid;
  v_client uuid := nullif(p ->> 'client_id', '')::uuid;
begin
  if not (public.can_change('packing') or public.can_change('freezer')) then
    raise exception 'You can''t put boxes in the freezer.' using errcode = '42501';
  end if;
  if v_client is not null then
    select id into v_id from public.freezer_boxes where client_id = v_client;
    if found then return v_id; end if;
  end if;
  select * into w from public.packing_weights
  where id = nullif(p ->> 'weight_id', '')::uuid or client_id = nullif(p ->> 'weight_client_id', '')::uuid
  for update
  limit 1;
  if not found then
    raise exception 'That box is gone from Packing.' using errcode = 'P0002';
  end if;
  if w.order_id is not null then
    raise exception 'This box is on a store now. It wasn''t put in the freezer.' using errcode = '55000';
  end if;
  perform set_config('uvl.source', 'leftover put in the freezer (Packing)', true);
  v_id := public.add_to_freezer(jsonb_build_object(
    'client_id', v_client,
    'product_id', w.product_id,
    'qty', coalesce(nullif(p ->> 'qty', '')::numeric, w.weight),
    'weight_lb', w.weight,
    'gtin', w.gtin, 'serial', w.serial, 'serial_date', w.serial_date, 'case_no', w.case_no,
    'pack_date', w.pack_date, 'lot', w.lot, 'raw_scan', w.raw_scan,
    'product_confirmed', true,
    'source', 'packing', 'reason', 'leftover', 'note', coalesce(p ->> 'note', ''),
    'added_on', coalesce((w.scanned_at at time zone 'America/Los_Angeles')::date, public.freezer_today()),
    'week_id', coalesce(w.week_id, public.order_week(public.freezer_today()))));
  delete from public.packing_weights where id = w.id;
  return v_id;
end $$;
revoke execute on function public.put_box_in_freezer(jsonb) from public, anon;
grant execute on function public.put_box_in_freezer(jsonb) to authenticated, service_role;

-- Take something out of a box. p: box_id, qty (default all that's left), reason, note, taken_on, client_id, counts_in_pnl.
create or replace function public.take_from_freezer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_client uuid := nullif(p ->> 'client_id', '')::uuid;
  v_box uuid := (p ->> 'box_id')::uuid;
begin
  if not public.can_change('freezer') then
    raise exception 'You can''t take things out of the freezer.' using errcode = '42501';
  end if;
  if coalesce(p ->> 'reason', '') in ('packed', 'half_whole') then
    raise exception 'That reason is set by Packing or Half and whole.';
  end if;
  if v_client is not null then
    select id into v_id from public.freezer_takes where client_id = v_client;
    if found then return v_id; end if;
  end if;
  insert into public.freezer_takes (client_id, box_id, qty, taken_on, reason, note, count_id, counts_in_pnl)
  select v_client, b.id, coalesce(nullif(p ->> 'qty', '')::numeric, b.qty_left),
    coalesce(nullif(p ->> 'taken_on', '')::date, public.freezer_today()),
    coalesce(nullif(p ->> 'reason', ''), 'taken_out'), coalesce(p ->> 'note', ''),
    nullif(p ->> 'count_id', '')::uuid, coalesce((p ->> 'counts_in_pnl')::boolean, false)
  from public.freezer_boxes b where b.id = v_box
  returning id into v_id;
  if v_id is null then
    raise exception 'That box is gone.';
  end if;
  return v_id;
end $$;
revoke execute on function public.take_from_freezer(jsonb) from public, anon;
grant execute on function public.take_from_freezer(jsonb) to authenticated, service_role;

-- Take a box back out because it was added by mistake (nothing taken from it yet).
create or replace function public.remove_freezer_box(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_change('freezer') then
    raise exception 'You can''t change the freezer.' using errcode = '42501';
  end if;
  if exists (select 1 from public.freezer_takes where box_id = p_id) then
    raise exception 'Something has been taken out of this box already, so it can''t be removed. Take the rest out instead.';
  end if;
  delete from public.freezer_boxes where id = p_id;
end $$;
revoke execute on function public.remove_freezer_box(uuid) from public, anon;
grant execute on function public.remove_freezer_box(uuid) to authenticated, service_role;

-- Admin: count a box as freezer income for its week, or not.
create or replace function public.set_freezer_income(p_id uuid, p_counts boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change whether this counts as freezer income.' using errcode = '42501';
  end if;
  update public.freezer_boxes set counts_as_income = p_counts where id = p_id;
  -- Its take-outs for orders follow.
  update public.freezer_takes set counts_in_pnl = p_counts where box_id = p_id and reason in ('packed', 'half_whole');
end $$;
revoke execute on function public.set_freezer_income(uuid, boolean) from public, anon;
grant execute on function public.set_freezer_income(uuid, boolean) to authenticated, service_role;

-- Admin: confirm the product of a box saved from a label the app didn't know.
-- The app learns the label, and every unconfirmed box with it is settled.
create or replace function public.confirm_freezer_box(p_id uuid, p_product text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_gtin text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can confirm a product.' using errcode = '42501';
  end if;
  select gtin into v_gtin from public.freezer_boxes where id = p_id;
  if not found then
    raise exception 'That box is gone.';
  end if;
  perform set_config('uvl.source', 'product confirmed (Freezer)', true);
  if v_gtin is not null then
    insert into public.gtin_products (gtin, product_id) values (v_gtin, p_product)
    on conflict (gtin) do update set product_id = excluded.product_id;
    update public.freezer_boxes set product_id = p_product, product_confirmed = true
    where gtin = v_gtin and not product_confirmed;
  end if;
  update public.freezer_boxes set product_id = p_product, product_confirmed = true where id = p_id;
end $$;
revoke execute on function public.confirm_freezer_box(uuid, text) from public, anon;
grant execute on function public.confirm_freezer_box(uuid, text) to authenticated, service_role;

-- A phone says how it's doing in a count (and joins it).
create or replace function public.freezer_count_checkin(p_count uuid, p_device text, p_person text, p_waiting int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_change('freezer') then
    raise exception 'You can''t count the freezer.' using errcode = '42501';
  end if;
  insert into public.freezer_count_devices (count_id, device_id, person_name, user_id, waiting, last_seen)
  values (p_count, p_device, coalesce(p_person, ''), auth.uid(), greatest(coalesce(p_waiting, 0), 0), now())
  on conflict (count_id, device_id) do update
  set person_name = excluded.person_name, user_id = excluded.user_id, waiting = excluded.waiting, last_seen = now();
end $$;
revoke execute on function public.freezer_count_checkin(uuid, text, text, int) from public, anon;
grant execute on function public.freezer_count_checkin(uuid, text, text, int) to authenticated, service_role;

-- Apply a count. The app works out the review (lib/calc/freezerCount.ts) and sends:
--   p_adds:     count item ids to add as boxes (stock-in: every one not skipped; reconcile: found boxes marked Add)
--   p_removals: [{box_id, reason, note}] boxes not counted that are marked removed (reconcile)
--   p_results:  the review as shown, kept on the count
--   p_anyway:   apply although phones still have scans waiting (admin only)
create or replace function public.apply_freezer_count(p_count uuid, p_adds uuid[], p_removals jsonb, p_results jsonb, p_anyway boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  i record;
  r jsonb;
  v_waiting int;
begin
  if not public.can_change('freezer') then
    raise exception 'You can''t count the freezer.' using errcode = '42501';
  end if;
  select * into c from public.freezer_counts where id = p_count for update;
  if not found then
    raise exception 'That count is gone.';
  end if;
  if c.status <> 'open' then
    raise exception 'This count was already finished.' using errcode = '55000';
  end if;
  select coalesce(sum(waiting), 0) into v_waiting from public.freezer_count_devices where count_id = p_count;
  if v_waiting > 0 and not coalesce(p_anyway, false) then
    raise exception '% scans haven''t uploaded yet. Apply when every phone has signal.', v_waiting using errcode = '55000';
  end if;
  if v_waiting > 0 and not public.is_admin() then
    raise exception 'Only an admin can apply a count while scans are still waiting.' using errcode = '42501';
  end if;

  perform set_config('uvl.source', case c.kind when 'stock_in' then 'freezer stock-in count' else 'freezer count' end, true);
  for i in
    select * from public.freezer_count_items
    where count_id = p_count and not voided and id = any (coalesce(p_adds, '{}'))
    order by scanned_at
  loop
    if i.product_id is null then
      raise exception 'A box in this count has no product yet. Choose its product first.';
    end if;
    -- Already in the freezer (added another way since): skip it.
    continue when i.serial is not null and i.gtin is not null
      and exists (select 1 from public.freezer_boxes b where b.gtin = i.gtin and b.serial = i.serial and b.qty_left > 0);
    insert into public.freezer_boxes (client_id, product_id, qty, weight_lb, gtin, serial, serial_date, case_no,
      pack_date, lot, raw_scan, product_confirmed, source, reason, added_on, count_id, created_by)
    values (i.id, i.product_id, i.qty, i.weight_lb, i.gtin, i.serial, i.serial_date, i.case_no,
      i.pack_date, i.lot, i.raw_scan, i.product_confirmed, 'count',
      case c.kind when 'stock_in' then 'stock_in' else 'found' end, c.count_date, p_count, i.created_by)
    on conflict (client_id) do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_removals, '[]'::jsonb)) loop
    insert into public.freezer_takes (box_id, qty, taken_on, reason, note, count_id)
    select b.id, b.qty_left, c.count_date, coalesce(nullif(r ->> 'reason', ''), 'not_found'), coalesce(r ->> 'note', ''), p_count
    from public.freezer_boxes b where b.id = (r ->> 'box_id')::uuid and b.qty_left > 0;
  end loop;

  update public.freezer_counts
  set status = 'applied', applied_by = auth.uid(), applied_at = now(), results = p_results,
      applied_anyway = v_waiting > 0
  where id = p_count;
end $$;
revoke execute on function public.apply_freezer_count(uuid, uuid[], jsonb, jsonb, boolean) from public, anon;
grant execute on function public.apply_freezer_count(uuid, uuid[], jsonb, jsonb, boolean) to authenticated, service_role;

-- Throw a count away (nothing in inventory changes).
create or replace function public.discard_freezer_count(p_count uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_change('freezer') then
    raise exception 'You can''t count the freezer.' using errcode = '42501';
  end if;
  update public.freezer_counts set status = 'discarded', discarded_by = auth.uid(), discarded_at = now()
  where id = p_count and status = 'open';
end $$;
revoke execute on function public.discard_freezer_count(uuid) from public, anon;
grant execute on function public.discard_freezer_count(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.freezer_counts enable row level security;
alter table public.freezer_count_items enable row level security;
alter table public.freezer_count_devices enable row level security;
alter table public.freezer_boxes enable row level security;
alter table public.freezer_box_values enable row level security;
alter table public.freezer_takes enable row level security;

-- Boxes and take-outs: read with Freezer (or whatever reads the freezer log); change only through the functions above.
create policy "freezer_boxes: read" on public.freezer_boxes for select to authenticated
  using ((select public.can_view_any(array['freezer', 'halfwhole', 'week', 'orders', 'downloads', 'pnl'])));
create policy "freezer_takes: read" on public.freezer_takes for select to authenticated
  using ((select public.can_view_any(array['freezer', 'halfwhole', 'week', 'orders', 'downloads', 'pnl'])));
-- Dollars: admins and the P&L.
create policy "freezer_box_values: read" on public.freezer_box_values for select to authenticated
  using ((select public.is_admin()) or (select public.can_view('pnl')));

create policy "freezer_counts: read" on public.freezer_counts for select to authenticated
  using ((select public.can_view('freezer')));
create policy "freezer_counts: start" on public.freezer_counts for insert to authenticated
  with check ((select public.can_change('freezer')) and status = 'open');
create policy "freezer_counts: note" on public.freezer_counts for update to authenticated
  using ((select public.can_change('freezer')) and status = 'open')
  with check ((select public.can_change('freezer')) and status = 'open');

create policy "freezer_count_items: read" on public.freezer_count_items for select to authenticated
  using ((select public.can_view('freezer')));
create policy "freezer_count_items: change" on public.freezer_count_items for all to authenticated
  using ((select public.can_change('freezer'))) with check ((select public.can_change('freezer')));

create policy "freezer_count_devices: read" on public.freezer_count_devices for select to authenticated
  using ((select public.can_view('freezer')));

revoke all on public.freezer_value_rates, public.freezer_counts, public.freezer_count_items, public.freezer_count_devices,
  public.freezer_boxes, public.freezer_box_values, public.freezer_takes from anon;
grant select on public.freezer_boxes, public.freezer_box_values, public.freezer_takes, public.freezer_count_devices
  to authenticated;
grant select, insert, update, delete on public.freezer_value_rates to authenticated;
grant select, insert, update on public.freezer_counts to authenticated;
grant select, insert, update, delete on public.freezer_count_items to authenticated;

-- Live updates for the freezer screens.
alter publication supabase_realtime add table
  public.freezer_boxes, public.freezer_takes, public.freezer_counts, public.freezer_count_items, public.freezer_count_devices;

-- ---------------------------------------------------------------------------
-- The packing role can add to the freezer and count it (Lucas, 11/19/26).
-- Only raises the default; a level an admin set higher stays.
-- ---------------------------------------------------------------------------
update public.role_permissions set level = 2 where role = 'packing' and area = 'freezer' and level < 2;
