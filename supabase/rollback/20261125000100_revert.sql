-- Undoes 20261125000100_freezer_boxes_and_counts.sql.
--
-- WARNING: this deletes every freezer box, take-out and count, and the freezer
-- log lines they wrote (so On hand goes back to what "Add or take out" and
-- Half and whole logged). Back up first:
--   freezer_boxes, freezer_box_values, freezer_takes, freezer_counts,
--   freezer_count_items, freezer_count_devices, freezer_value_rates.
--
-- The packing role's Freezer permission goes back to Off (only if it is still
-- the Change this migration set).

alter publication supabase_realtime drop table
  public.freezer_boxes, public.freezer_takes, public.freezer_counts, public.freezer_count_items, public.freezer_count_devices;

drop trigger if exists packing_weights_freezer_box on public.packing_weights;
drop trigger if exists freezer_log_box_guard on public.freezer_log;
drop trigger if exists freezer_log_takes_oldest on public.freezer_log;
drop trigger if exists freezer_log_takes_back on public.freezer_log;

-- The log lines boxes and take-outs wrote.
delete from public.freezer_log where freezer_box_id is not null or freezer_take_id is not null;
alter table public.freezer_log drop column if exists freezer_take_id, drop column if exists freezer_box_id;

drop function if exists public.apply_freezer_count(uuid, uuid[], jsonb, jsonb, boolean);
drop function if exists public.discard_freezer_count(uuid);
drop function if exists public.freezer_count_checkin(uuid, text, text, int);
drop function if exists public.set_freezer_income(uuid, boolean);
drop function if exists public.confirm_freezer_box(uuid, text);
drop function if exists public.remove_freezer_box(uuid);
drop function if exists public.take_from_freezer(jsonb);
drop function if exists public.put_box_in_freezer(jsonb);
drop function if exists public.add_to_freezer(jsonb);

drop table if exists public.freezer_takes;
drop table if exists public.freezer_box_values;
drop table if exists public.freezer_boxes;
drop table if exists public.freezer_count_devices;
drop table if exists public.freezer_count_items;
drop table if exists public.freezer_counts;
drop table if exists public.freezer_value_rates;

drop function if exists public.freezer_box_packed();
drop function if exists public.freezer_log_takes_oldest();
drop function if exists public.freezer_log_box_guard();
drop function if exists public.freezer_count_items_open();
drop function if exists public.freezer_takes_after();
drop function if exists public.freezer_takes_before();
drop function if exists public.freezer_boxes_after();
drop function if exists public.freezer_boxes_before();
drop function if exists public.freezer_today();
drop function if exists public.freezer_value(text, numeric, numeric, date);

update public.role_permissions set level = 0 where role = 'packing' and area = 'freezer' and level = 2;
