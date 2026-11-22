-- Ask: read-only access for the assistant (Lucas, 11/22/26).
--
-- Staff type a question; the assistant writes its own SQL. Safety comes from
-- the database, not from trusting the model:
--
-- * Schema `ai`: views only, one per table the assistant may read, with the
--   columns it may see. Left out everywhere: the audit log, permissions,
--   photo and file paths, raw scans, hashes. Not exposed through the API
--   (anon and authenticated get nothing on it).
-- * One login role per app role: ai_reader_admin, ai_reader_office,
--   ai_reader_packing, ai_reader_viewer, ai_reader_billing. Each may only
--   use schema `ai` and SELECT the views its app role can see. No table in
--   public, no other schema, no write grant. Every session is read-only
--   with a 5 second statement limit. The roles have no password: Lucas sets
--   one by hand for each role Ask uses (see lib/ai/README.md).
-- * Which views a reader may SELECT follows the app's screen permissions:
--   each view lists the screen areas whose View lets a person read its table
--   (the same areas as that table's read policy). Admins read every view; a
--   role reads a view when its role defaults (role_permissions) give View or
--   Change in any of the view's areas. One exception to "same as the
--   table": household names and phones (half_whole_contacts) leave out the
--   Freezer area, so Packing never sees households (Lucas, 11/22/26). A change on the Users screen to a
--   role's defaults re-grants at once (trigger). Per-person overrides don't
--   apply: Ask goes by role.
-- * Adding a view later: create it in `ai`, add a row to
--   ai_private.view_areas, then `select ai_private.sync_reader_grants();`.
--
-- No new table in public and no foreign keys.
-- Undo: supabase/rollback/20261126000100_revert.sql

create schema ai;
comment on schema ai is 'Read-only views for the Ask assistant. Not exposed through the API.';
create schema ai_private;
comment on schema ai_private is 'Bookkeeping for the Ask readers. Not exposed through the API.';
revoke all on schema ai, ai_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reader roles
-- ---------------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['ai_reader_admin', 'ai_reader_office', 'ai_reader_packing',
                           'ai_reader_viewer', 'ai_reader_billing'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I login noinherit nocreatedb nocreaterole connection limit 10', r);
    end if;
    execute format('alter role %I set default_transaction_read_only = on', r);
    execute format('alter role %I set statement_timeout = %L', r, '5s');
    execute format('alter role %I set idle_in_transaction_session_timeout = %L', r, '15s');
    execute format('alter role %I set search_path = ai', r);
    execute format('grant usage on schema ai to %I', r);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Views. Plain views owned by the migration role: they read the tables
-- whatever the reader's own rights (the readers have none on public).
-- ---------------------------------------------------------------------------

-- Everyone signed in sees these in the app.
create view ai.app_settings as
  select processor_name, company_name, box_cap_lb, le_trim_shoulder_lb, le_trim_leg_lb,
         pack_unknown_blanks, pack_spare_blanks, ship_from_address
  from public.app_settings;
create view ai.people as
  select id, display_name, role, active from public.profiles;
create view ai.parts as
  select id, name, per_lamb, unit, balance_check, drives_count, made_from, confirmed, source_note, sort
  from public.parts;
create view ai.products as
  select id, name, short_name, label_name, unit, alt_unit, lb_per_unit, pieces_per_pack, order_step,
         group_name, packed_with, draws_from, fills_product_id, price_unit, per_box, fresh_only,
         counts_toward_lambs, not_lamb, carcass, fill_note, active, confirmed, mohawk_item_no,
         box_lb_min, box_lb_max, note, sort
  from public.products;
create view ai.product_part_uses as select product_id, part_id, qty from public.product_part_uses;
create view ai.product_cut_specs as
  select product_id, cut_spec_id, units_per_cut, sort from public.product_cut_specs;
create view ai.cut_specs as select id, text, use_type, active, sort from public.cut_specs;
create view ai.size_classes as select id, label, weight_range, sort from public.size_classes;
create view ai.box_types as
  select id, name, size_rank, active, length_in, width_in, height_in, max_weight_lb from public.box_types;
create view ai.product_box_limits as
  select product_id, box_type_id, max_count, max_lb, status, note from public.product_box_limits;

-- Customers
create view ai.customers as
  select id, name, type, parent_customer_id, active, call_day, delivery_day, ships_to_point_id,
         bills_for_locations, lines_only_if_extra, notes, pallet_group_id
  from public.customers;
create view ai.customer_contacts as
  select id, customer_id, name, roles, phone, email, sort from public.customer_contacts;
create view ai.customer_billing as
  select customer_id, invoice_code, bill_to_address, terms_days, box_detail from public.customer_billing;
create view ai.contact_log as
  select id, customer_id, kind, summary, follow_up_date, follow_up_note, follow_up_done, created_by, created_at
  from public.contact_log where deleted_at is null;
create view ai.consolidation_points as
  select id, name, short_name, code, carrier, cross_dock, active, note from public.consolidation_points;
create view ai.pallet_groups as select id, name, sort from public.pallet_groups;

-- Weeks and orders
create view ai.weeks as
  select id, invoice_number, process_date, producer, lamb_override, notes, no_processing,
         no_processing_note, labels_printed_at
  from public.weeks;
create view ai.orders as
  select id, week_id, customer_id, status, notes, updated_at from public.orders;
create view ai.order_lines as
  select order_id, product_id, qty, unit, only_if_extra, fill_qty, fill_chosen, fill_locked
  from public.order_lines;
create view ai.order_requests as
  select id, week_id, customer_id, product_id, qty, unit, requested_at, requested_by, moved_from_week
  from public.order_requests;
create view ai.week_extra_lambs as
  select id, week_id, lambs, reason, note from public.week_extra_lambs;
create view ai.le_trim_plans as
  select week_id, shoulders, half_legs, legs, trim_lb, trim_estimated_lb, trim_actual_lb, saved_by, saved_at
  from public.le_trim_plans;

-- Cut sheet
create view ai.cut_sheets as
  select week_id, notes, pulled_large, pulled_medium, pulled_small, sent_at, sent_by from public.cut_sheets;
create view ai.cut_sheet_banners as select id, week_id, text, sort from public.cut_sheet_banners;
create view ai.cut_sets as
  select id, week_id, name, lambs, size_class_id, headline, sort, filled_week from public.cut_sets;
create view ai.cut_set_lines as
  select id, set_id, kind, cut_spec_id, use_type, qty, text, side_note, highlight, shank_on, sort
  from public.cut_set_lines;
create view ai.cut_set_customers as select set_id, customer_id from public.cut_set_customers;
create view ai.saving_goals as select id, text, active from public.saving_goals;

-- Packing, boxes, lots, pallets
create view ai.packing_lines as
  select order_id, product_id, packed_qty, packed_by, packed_at, shorted, flagged, flag_note
  from public.packing_lines;
create view ai.packing_orders as
  select order_id, boxes, pallet, updated_at from public.packing_orders;
create view ai.packing_weights as
  select id, week_id, order_id, product_id, label_product_id, weight, source, gtin, serial, serial_date,
         case_no, pack_date, lot, pallet_id, box_type_id, slot, label_no, box_no, route, offered,
         off_order, scanned_at, created_at, created_by, corrected_at, correction_reason
  from public.packing_weights;
create view ai.packing_conflicts as
  select id, kind, message, order_id, product_id, gtin, serial, created_at, resolved_at, resolution
  from public.packing_conflicts;
create view ai.box_labels as
  select week_id, number, key, printed_at, printed_by from public.box_labels;
create view ai.label_prints as
  select id, week_id, number, printed_at, printed_by, reprint from public.label_prints;
create view ai.gtin_products as select gtin, product_id, note from public.gtin_products;
create view ai.lots as select id, gtin, pack_date, lot, source_note from public.lots;
create view ai.pallets as
  select id, week_id, tag, status, ship_date, number, label, note, length_in, width_in,
         max_height_in, max_weight_lb
  from public.pallets;
create view ai.shipments as
  select id, week_id, ship_to_customer_id, ship_to_point_id, ship_date from public.shipments;
create view ai.pallet_shipments as select pallet_id, shipment_id from public.pallet_shipments;
create view ai.pallet_customers as select pallet_id, customer_id from public.pallet_customers;
create view ai.pallet_plan_lines as
  select id, pallet_id, customer_id, product_id, box_type_id, planned_boxes from public.pallet_plan_lines;
-- The manifest is not stored; the app builds it from these. One row per box
-- on a pallet (or on none), with its customer.
create view ai.manifest_boxes as
  select w.id as box_id, w.week_id, p.id as pallet_id, p.tag as pallet_tag, p.status as pallet_status,
         o.customer_id, c.name as customer_name, w.product_id, w.label_product_id, w.label_no,
         w.serial, w.lot, w.weight as net_lb, w.source, w.scanned_at
  from public.packing_weights w
  left join public.pallets p on p.id = w.pallet_id
  left join public.orders o on o.id = w.order_id
  left join public.customers c on c.id = o.customer_id;

-- Freezer, half and whole
create view ai.freezer_log as
  select id, entry_date, product_id, qty, note, half_whole_order_id, freezer_box_id, freezer_take_id, created_by
  from public.freezer_log;
create view ai.freezer_boxes as
  select id, product_id, qty, qty_left, weight_lb, gtin, serial, serial_date, case_no, pack_date, lot,
         product_confirmed, source, reason, note, added_on, week_id, counts_as_income, count_id, created_by
  from public.freezer_boxes;
create view ai.freezer_takes as
  select id, box_id, qty, taken_on, week_id, reason, note, packing_weight_id, half_whole_order_id,
         counts_in_pnl, created_by
  from public.freezer_takes;
create view ai.freezer_counts as
  select id, kind, product_ids, status, count_date, note, started_by, started_at, applied_by, applied_at,
         applied_anyway
  from public.freezer_counts;
create view ai.freezer_count_items as
  select id, count_id, kind, product_id, qty, weight_lb, gtin, serial, pack_date, lot, decision, voided, scanned_at
  from public.freezer_count_items;
create view ai.freezer_box_values as
  select box_id, priced_on, price_product_id, price, price_unit, percent, value, note
  from public.freezer_box_values;
create view ai.freezer_value_rates as
  select id, effective_from, percent, note from public.freezer_value_rates;
-- Households: the order itself wherever the app shows half and whole
-- orders (the Freezer screen too); the name, phone and notes only where
-- household details are worked with (not Freezer, so not Packing).
create view ai.half_whole_orders as
  select id, size, status, need_by, created_by, created_at from public.half_whole_orders;
create view ai.half_whole_contacts as
  select id as order_id, customer_name, phone, notes from public.half_whole_orders;
create view ai.half_whole_choices as
  select order_id, part_id, slot, product_id from public.half_whole_choices;

-- Prices and invoices
create view ai.prices as
  select id, product_id, customer_id, price, effective_from, note from public.prices;
create view ai.carcass_charges as
  select id, product_id, customer_id, name, amount, effective_from, note from public.carcass_charges;
create view ai.freight_charges as
  select id, customer_id, method, amount, effective_from, note from public.freight_charges;
create view ai.invoice_settings as
  select business_name, business_address, business_phone, business_email, remit_to,
         default_terms_days, invoice_note
  from public.invoice_settings;
create view ai.invoices as
  select id, week_id, customer_id, number, sale_no, reissue, replaces_id, status, invoice_date,
         terms_days, due_date, total, memo, created_at, finalized_at, sent_at, voided_at, void_reason
  from public.invoices;
create view ai.invoice_lines as
  select id, invoice_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
         price_unit, unit_price, discount_kind, discount, not_on_order, note, detail, sort
  from public.invoice_lines;
create view ai.invoice_boxes as
  select id, invoice_id, box_id, product_id, weight, lot, pack_date, serial, label_no, case_no, source
  from public.invoice_boxes;
create view ai.payments as
  select id, invoice_id, paid_on, amount, method, reference, note from public.payments;

-- Truck runs
create view ai.truck_drivers as select id, name, active, maintenance, note from public.truck_drivers;
create view ai.truck_driver_rates as
  select id, driver_id, effective_from, base, per_extra, per_skipped, note from public.truck_driver_rates;
create view ai.truck_runs as
  select id, run_date, week_id, driver_id, fuel, note from public.truck_runs;
create view ai.truck_run_stops as
  select id, run_id, kind, customer_id, point_id, name, sort from public.truck_run_stops;

-- Producers, carcass weights, producer pay (lamb cost)
create view ai.producers as select id, name, ranch_name, contact, active from public.producers;
create view ai.producer_rates as
  select id, producer_id, effective_from, rate, note from public.producer_rates;
create view ai.lamb_cost_settings as
  select id, effective_from, base_rate, live_factor, note from public.lamb_cost_settings;
create view ai.kill_sheets as
  select id, producer_id, kill_date, week_id, base_rate, live_factor, rate_source, notes,
         override_reason, override_at
  from public.kill_sheets;
create view ai.kill_lambs as select id, sheet_id, position, carcass_lb from public.kill_lambs;
create view ai.kill_adjustments as
  select id, sheet_id, lamb_id, kind, amount, reason, note from public.kill_adjustments;

-- Weekly P&L
create view ai.expense_categories as
  select id, name, group_name, method, income_base, base_category_ids, note, truck_part, delivery_kind,
         carrier, customer_ids, weight_basis, active, sort
  from public.expense_categories;
create view ai.expense_category_rates as
  select id, category_id, effective_from, amount, percent, parts, per_box_lb, per_pallet_lb, note
  from public.expense_category_rates;
create view ai.pnl_expenses as
  select id, entry_date, week_id, category_id, amount, note, created_by from public.pnl_expenses;
create view ai.pnl_income as
  select id, entry_date, week_id, customer_id, customer_name, amount, note from public.pnl_income;
create view ai.pnl_adjustments as
  select id, week_id, kind, line_key, side, label, amount, reason, created_by_name, created_at,
         voided_at, void_reason
  from public.pnl_adjustments;
create view ai.pnl_closed_weeks as
  select week_id, closed_at, closed_by_name, snapshot, missing from public.pnl_closed_weeks;
create view ai.pnl_week_reviews as select week_id, name, reviewed_at from public.pnl_week_reviews;
create view ai.pnl_week_events as
  select week_id, action, reason, missing, by_name, at from public.pnl_week_events;
create view ai.pnl_owners as select id, name, profile_id, sort from public.pnl_owners;

revoke all on all tables in schema ai from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Which screen areas open each view (from each table's read policy).
-- '*' = everyone signed in. An empty list = admins only.
-- ---------------------------------------------------------------------------
create table ai_private.view_areas (
  view_name text primary key,
  areas text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table ai_private.view_areas is
  'Ask: the screen areas whose View opens each ai view to a role (admins read all).';
alter table ai_private.view_areas enable row level security;
create policy "view_areas: admin read" on ai_private.view_areas
  for select to authenticated using ((select public.is_admin()));
revoke all on ai_private.view_areas from public, anon, authenticated;

insert into ai_private.view_areas (view_name, areas) values
  ('app_settings', '{*}'), ('people', '{*}'), ('parts', '{*}'), ('products', '{*}'),
  ('product_part_uses', '{*}'), ('product_cut_specs', '{*}'), ('cut_specs', '{*}'),
  ('size_classes', '{*}'), ('box_types', '{*}'), ('product_box_limits', '{*}'),
  ('customers', '{customers,calls,orders,week,cutsheet,packing,downloads,pnl}'),
  ('customer_contacts', '{customers,calls,orders,downloads}'),
  ('customer_billing', '{invoices,prices,customers}'),
  ('contact_log', '{callnotes}'),
  ('consolidation_points', '{customers,calls,orders,week,cutsheet,packing,downloads}'),
  ('pallet_groups', '{packing,customers,setup,orders,downloads}'),
  ('weeks', '{week,orders,calls,packing,cutsheet,downloads,pnl}'),
  ('orders', '{orders,calls,week,packing,cutsheet,customers,downloads,pnl}'),
  ('order_lines', '{orders,calls,week,packing,cutsheet,customers,downloads,pnl}'),
  ('order_requests', '{orders,calls,week,cutsheet,customers,downloads}'),
  ('week_extra_lambs', '{week,orders,calls,packing,cutsheet,downloads}'),
  ('le_trim_plans', '{week,cutsheet,orders,calls}'),
  ('cut_sheets', '{cutsheet,week,downloads}'), ('cut_sheet_banners', '{cutsheet,week,downloads}'),
  ('cut_sets', '{cutsheet,week,downloads}'), ('cut_set_lines', '{cutsheet,week,downloads}'),
  ('cut_set_customers', '{cutsheet,week,downloads}'), ('saving_goals', '{cutsheet,week,downloads}'),
  ('packing_lines', '{packing,orders,week,downloads,pnl}'),
  ('packing_orders', '{packing,orders,week,downloads}'),
  ('packing_weights', '{packing,orders,week,downloads,pnl}'),
  ('packing_conflicts', '{packing,orders,week}'),
  ('box_labels', '{packing,week,orders}'), ('label_prints', '{packing,week,orders}'),
  ('gtin_products', '{packing,setup,freezer}'),
  ('lots', '{packing,setup,freezer,downloads}'),
  ('pallets', '{packing,orders,week,downloads,pnl}'),
  ('shipments', '{packing,orders,week,downloads}'),
  ('pallet_shipments', '{packing,orders,week,downloads}'),
  ('pallet_customers', '{packing,orders,week,downloads}'),
  ('pallet_plan_lines', '{packing,orders,week,downloads}'),
  ('manifest_boxes', '{packing,orders,week,downloads,pnl}'),
  ('freezer_log', '{freezer,halfwhole,week,orders,downloads}'),
  ('freezer_boxes', '{freezer,halfwhole,week,orders,downloads,pnl}'),
  ('freezer_takes', '{freezer,halfwhole,week,orders,downloads,pnl}'),
  ('freezer_counts', '{freezer}'), ('freezer_count_items', '{freezer}'),
  ('freezer_box_values', '{pnl}'), ('freezer_value_rates', '{pnl}'),
  ('half_whole_orders', '{halfwhole,week,orders,freezer,downloads}'),
  ('half_whole_contacts', '{halfwhole,week,orders,downloads}'),
  ('half_whole_choices', '{halfwhole,week,orders,freezer,downloads}'),
  ('prices', '{prices,invoices,pnl}'), ('carcass_charges', '{prices,invoices,pnl}'),
  ('freight_charges', '{prices,invoices,pnl}'), ('invoice_settings', '{invoices,prices}'),
  ('invoices', '{invoices,pnl}'), ('invoice_lines', '{invoices,pnl}'),
  ('invoice_boxes', '{invoices,pnl}'), ('payments', '{invoices}'),
  ('truck_drivers', '{trucks,pnl}'), ('truck_driver_rates', '{trucks,pnl}'),
  ('truck_runs', '{trucks,pnl}'), ('truck_run_stops', '{trucks,pnl}'),
  ('producers', '{carcass,pnl}'), ('producer_rates', '{carcass,pnl}'),
  ('lamb_cost_settings', '{carcass,pnl}'), ('kill_sheets', '{carcass,pnl}'),
  ('kill_lambs', '{carcass,pnl}'), ('kill_adjustments', '{carcass,pnl}'),
  ('expense_categories', '{pnl}'), ('expense_category_rates', '{pnl}'),
  ('pnl_expenses', '{pnl}'), ('pnl_income', '{pnl}'), ('pnl_adjustments', '{pnl}'),
  ('pnl_closed_weeks', '{pnl}'), ('pnl_week_reviews', '{pnl}'), ('pnl_week_events', '{pnl}'),
  ('pnl_owners', '{pnl}');

-- ---------------------------------------------------------------------------
-- Grant each reader the views its app role can see; revoke the rest.
-- ---------------------------------------------------------------------------
create function ai_private.sync_reader_grants()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v record;
  allowed boolean;
begin
  for r in select * from (values ('admin', 'ai_reader_admin'), ('office', 'ai_reader_office'),
                                 ('packing', 'ai_reader_packing'), ('viewer', 'ai_reader_viewer'),
                                 ('billing', 'ai_reader_billing')) x(app_role, reader) loop
    for v in select va.view_name, va.areas from ai_private.view_areas va
             join pg_views pv on pv.schemaname = 'ai' and pv.viewname = va.view_name loop
      allowed := r.app_role = 'admin'
        or '*' = any (v.areas)
        or exists (select 1 from public.role_permissions p
                   where p.role = r.app_role and p.area = any (v.areas) and p.level >= 1);
      if allowed then
        execute format('grant select on ai.%I to %I', v.view_name, r.reader);
      else
        execute format('revoke all on ai.%I from %I', v.view_name, r.reader);
      end if;
    end loop;
  end loop;
end;
$$;
revoke execute on function ai_private.sync_reader_grants() from public, anon, authenticated;

create function ai_private.role_permissions_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform ai_private.sync_reader_grants();
  return null;
end;
$$;
revoke execute on function ai_private.role_permissions_changed() from public, anon, authenticated;

create trigger role_permissions_ask_grants
  after insert or update or delete on public.role_permissions
  for each statement execute function ai_private.role_permissions_changed();

select ai_private.sync_reader_grants();
