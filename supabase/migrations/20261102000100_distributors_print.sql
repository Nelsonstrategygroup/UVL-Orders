-- Distributors for the printed paperwork (Lucas, 11/2/26): cross dock
-- sheets, pallet labels and the manifests read each distributor's short name
-- ("Plymouth 1 of 3"), short code (PP), carrier, cross dock name and color.
--
-- 1. consolidation_points: short_name, code, carrier, cross_dock, color.
-- 2. "Plymouth" becomes Plymouth Poultry (short name Plymouth, PP, carrier
--    Peterson, forest green #3B5E27); Corfini Gourmet is added (Corfini, CG,
--    barn red #7A3327; carrier and cross dock blank for now); Newport Ave
--    ships through Corfini Gourmet. PCC stores, Key City and Port Townsend
--    already ship through Plymouth.
-- 3. app_settings: a primary and a secondary contact (name, phone, email),
--    printed on the sheets and labels.
-- Nothing here changes orders, boxes, pallets or packing.
-- Undo: supabase/rollback/20261102000100_revert.sql

-- 1. Distributor details -------------------------------------------------------------
alter table public.consolidation_points
  add column short_name text not null default '',
  add column code text not null default '' check (code = '' or code ~ '^[A-Z0-9]{1,4}$'),
  add column carrier text not null default '',
  add column cross_dock text not null default '',
  add column color text not null default '#3B5E27' check (color ~ '^#[0-9A-Fa-f]{6}$');
comment on column public.consolidation_points.short_name is 'Short name for pallets: "Plymouth 1 of 3". Blank: the name.';
comment on column public.consolidation_points.code is 'Short code on the cross dock sheet and pallet labels (PP), 1 to 4 capitals or digits.';
comment on column public.consolidation_points.carrier is 'Who carries the pallets to the distributor (Peterson).';
comment on column public.consolidation_points.cross_dock is 'The cross dock name printed on the cross dock sheet.';
comment on column public.consolidation_points.color is 'The distributor''s color on the cross dock sheet and pallet labels, #RRGGBB.';

-- 2. Plymouth Poultry and Corfini Gourmet ---------------------------------------------
update public.consolidation_points
set name = 'Plymouth Poultry', short_name = 'Plymouth', code = 'PP', carrier = 'Peterson', color = '#3B5E27'
where name = 'Plymouth';

insert into public.consolidation_points (name, short_name, code, color, note)
select 'Corfini Gourmet', 'Corfini', 'CG', '#7A3327', ''
where not exists (select 1 from public.consolidation_points where name = 'Corfini Gourmet');

update public.customers
set ships_to_point_id = (select id from public.consolidation_points where name = 'Corfini Gourmet')
where name = 'Newport Ave' and parent_customer_id is null and ships_to_point_id is null;

-- 3. Contacts on the paperwork -------------------------------------------------------
alter table public.app_settings
  add column contact1_name text not null default '',
  add column contact1_phone text not null default '',
  add column contact1_email text not null default '',
  add column contact2_name text not null default '',
  add column contact2_phone text not null default '',
  add column contact2_email text not null default '';
comment on column public.app_settings.contact1_name is 'Primary contact printed on cross dock sheets and pallet labels (with phone and email).';
comment on column public.app_settings.contact2_name is 'Secondary contact printed on cross dock sheets (with phone and email).';
