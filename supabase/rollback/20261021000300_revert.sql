-- Undo 20261021000300_move_order_weeks.sql: the weeks go back where they were
-- filed (Oct 12 -> Oct 5, then Oct 19 -> Oct 12). Stops if orders were added
-- to Oct 5 or Oct 12 in the meantime. Rows as before the move are in
-- backups/20261021T*_move_order_weeks_*.json.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261021000300_revert.sql

begin;

create or replace function pg_temp.move_week(p_from date, p_to date) returns void
language plpgsql as $fn$
begin
  if exists (select 1 from public.orders where week_id = p_to) then
    raise exception 'Week % already has orders', p_to;
  end if;
  if exists (select 1 from public.cut_sheets where week_id = p_to) then
    raise exception 'Week % already has a cut sheet', p_to;
  end if;

  -- The week row: producer, notes, lamb count override, label print stamp.
  insert into public.weeks (id, process_date, producer, lamb_override, notes, labels_hash, labels_printed_at, labels_printed_by)
  select p_to, process_date + (p_to - p_from), producer, lamb_override, notes, labels_hash, labels_printed_at, labels_printed_by
  from public.weeks where id = p_from
  on conflict (id) do update set
    process_date = excluded.process_date, producer = excluded.producer, lamb_override = excluded.lamb_override,
    notes = excluded.notes, labels_hash = excluded.labels_hash, labels_printed_at = excluded.labels_printed_at,
    labels_printed_by = excluded.labels_printed_by;

  update public.orders set week_id = p_to where week_id = p_from;
  update public.pallets set week_id = p_to where week_id = p_from;

  -- The cut sheet: its sets and banners hang off the sheet's week.
  if exists (select 1 from public.cut_sheets where week_id = p_from) then
    insert into public.cut_sheets (week_id, inv_number, notes, pulled_large, pulled_medium, pulled_small, sent_at, sent_hash, sent_by)
    select p_to, inv_number, notes, pulled_large, pulled_medium, pulled_small, sent_at, sent_hash, sent_by
    from public.cut_sheets where week_id = p_from;
    update public.cut_sets set week_id = p_to,
      filled_week = case when filled_week = p_from then p_to else filled_week end
      where week_id = p_from;
    update public.cut_sheet_banners set week_id = p_to where week_id = p_from;
    delete from public.cut_sheets where week_id = p_from;
  end if;

  -- The old week is left empty.
  update public.weeks set process_date = null, producer = '', lamb_override = null, notes = '',
    labels_hash = null, labels_printed_at = null, labels_printed_by = null
    where id = p_from;
end
$fn$;

select pg_temp.move_week('2026-10-12', '2026-10-05');
select pg_temp.move_week('2026-10-19', '2026-10-12');

delete from supabase_migrations.schema_migrations where version = '20261021000300';

commit;
