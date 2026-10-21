-- Box types, box limits, the 45 lb cap, label names, and the label print
-- fingerprint (SPEC 12, change request 10/20/26 part 2).
-- Revert: supabase/rollback/20261021000100_revert.sql
-- Backups before this change: backups/20261021T053639Z_*.json
--
-- Nothing here touches orders or order lines.

-- What's printed on a box label; blank means the product name. ----------------
alter table public.products add column label_name text not null default '';
comment on column public.products.label_name is 'What is printed on a box label ("Single Pack Rack (Cap ON)"). Blank: the product name.';

-- The 45 lb cap: no box is ever planned heavier. -----------------------------
alter table public.app_settings add column box_cap_lb numeric not null default 45 check (box_cap_lb > 0);
comment on column public.app_settings.box_cap_lb is 'No box is planned over this many pounds, for any product or box type.';

-- When the box labels were printed, and a fingerprint of the list. --------------
alter table public.weeks
  add column labels_hash text,
  add column labels_printed_at timestamptz,
  add column labels_printed_by uuid references public.profiles (id);

-- Box types, largest first. ----------------------------------------------------
create table public.box_types (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  -- 1 is the largest.
  size_rank int not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.box_types is 'The boxes products go in, largest first (size_rank 1).';
create trigger box_types_updated_at before update on public.box_types for each row execute function public.set_updated_at();
create trigger box_types_audit after insert or update or delete on public.box_types for each row execute function public.audit_row();
alter table public.box_types enable row level security;
create policy "box_types: read" on public.box_types for select to authenticated using (true);
create policy "box_types: change" on public.box_types for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.box_types from anon;
grant select, insert, update, delete on public.box_types to authenticated;

insert into public.box_types (id, name, size_rank) values
  ('mvm', 'MVM', 1), ('roll-stock', 'Roll Stock', 2), ('jerky', 'Jerky', 3), ('white', 'White', 4), ('baby', 'Baby', 5)
on conflict (id) do nothing;

-- How much of a product fits in each box type. ----------------------------------
create table public.product_box_limits (
  product_id text not null references public.products (id) on delete cascade,
  box_type_id text not null references public.box_types (id) on delete cascade,
  -- In the product's own unit (pieces, packs, or lb).
  max_count numeric check (max_count is null or max_count > 0),
  max_lb numeric check (max_lb is null or max_lb > 0),
  -- ok: use the limit. does_not_fit: never goes in this box. needs_checking: Kathy to confirm.
  status text not null default 'ok' check (status in ('ok', 'does_not_fit', 'needs_checking')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (product_id, box_type_id),
  constraint product_box_limits_ok_has_limit check (status <> 'ok' or max_count is not null or max_lb is not null)
);
comment on table public.product_box_limits is 'Box limits per product and box type (SPEC 12.2), from Kathy''s box sheet. A box''s limit is the lowest of max_count, what fits under max_lb, and what fits under the box cap.';
create trigger product_box_limits_updated_at before update on public.product_box_limits for each row execute function public.set_updated_at();
create trigger product_box_limits_audit after insert or update or delete on public.product_box_limits for each row execute function public.audit_row();
alter table public.product_box_limits enable row level security;
create policy "product_box_limits: read" on public.product_box_limits for select to authenticated using (true);
create policy "product_box_limits: change" on public.product_box_limits for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.product_box_limits from anon;
grant select, insert, update, delete on public.product_box_limits to authenticated;

-- Kathy's box sheet ----------------------------------------------------------------
-- First, five product names change to match the sheet (Lucas, 10/20/26).
-- Matched to active products by name. Rows for products that aren't there are
-- skipped (a fresh install runs this again after its catalog is seeded).
create or replace function public.load_box_limits()
returns int
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  n int;
begin
  -- Five product names now match Kathy's box sheet (Lucas, 10/20/26). -------------
  update public.products set name = 'BNLS Loins' where id = 'cp-boneless-loins' and name = 'Boneless Loins';
  update public.products set name = 'Cap On Rack' where id = 'cp-cap-on-rack' and name = 'Rack';
  update public.products set name = 'BNLS Legs' where id = 'cp-bls-legs' and name = 'BLS Legs';
  update public.products set name = 'BNLS Shoulder' where id = 'cp-bls-shoulder' and name = 'BLS Shoulder';
  update public.products set name = 'Pet Mix' where id = 'cp-pet' and name = 'Pet';

  insert into public.product_box_limits (product_id, box_type_id, max_count, max_lb, status, note)
  select p.id, v.box_type, v.max_count::numeric, v.max_lb::numeric, v.status, coalesce(v.note, '')
  from (values
      ('Whole Lamb', 'pcs', 'mvm', 1, null, 'ok', null),
      ('Whole Lamb', 'pcs', 'roll-stock', null, null, 'does_not_fit', null),
      ('Whole Lamb', 'pcs', 'jerky', null, null, 'does_not_fit', null),
      ('Whole Lamb', 'pcs', 'white', null, null, 'does_not_fit', null),
      ('Whole Lamb', 'pcs', 'baby', null, null, 'does_not_fit', null),
      ('Carcass Lamb', 'pcs', 'mvm', null, null, 'does_not_fit', 'Goes out in a shroud, never boxed. No labels.'),
      ('Carcass Lamb', 'pcs', 'roll-stock', null, null, 'does_not_fit', 'Goes out in a shroud, never boxed. No labels.'),
      ('Carcass Lamb', 'pcs', 'jerky', null, null, 'does_not_fit', 'Goes out in a shroud, never boxed. No labels.'),
      ('Carcass Lamb', 'pcs', 'white', null, null, 'does_not_fit', 'Goes out in a shroud, never boxed. No labels.'),
      ('Carcass Lamb', 'pcs', 'baby', null, null, 'does_not_fit', 'Goes out in a shroud, never boxed. No labels.'),
      ('Whole Loin', 'pcs', 'mvm', 4, null, 'ok', null),
      ('Whole Loin', 'pcs', 'roll-stock', 2, null, 'ok', null),
      ('Whole Loin', 'pcs', 'jerky', null, null, 'does_not_fit', null),
      ('Whole Loin', 'pcs', 'white', null, null, 'does_not_fit', null),
      ('Whole Loin', 'pcs', 'baby', null, null, 'does_not_fit', null),
      ('Chops', 'lb', 'mvm', null, 45, 'ok', null),
      ('Chops', 'lb', 'roll-stock', null, 25, 'ok', null),
      ('Chops', 'lb', 'jerky', null, 15, 'ok', null),
      ('Chops', 'lb', 'white', null, 12, 'ok', null),
      ('Chops', 'lb', 'baby', null, null, 'needs_checking', null),
      ('Thick Chops', 'lb', 'mvm', null, null, 'needs_checking', 'Sheet says NA; Kathy called it irrelevant. Confirm it''s still sold.'),
      ('Thick Chops', 'lb', 'roll-stock', null, null, 'needs_checking', 'Sheet says NA; Kathy called it irrelevant. Confirm it''s still sold.'),
      ('Thick Chops', 'lb', 'jerky', null, null, 'needs_checking', 'Sheet says NA; Kathy called it irrelevant. Confirm it''s still sold.'),
      ('Thick Chops', 'lb', 'white', null, null, 'needs_checking', 'Sheet says NA; Kathy called it irrelevant. Confirm it''s still sold.'),
      ('Thick Chops', 'lb', 'baby', null, null, 'needs_checking', 'Sheet says NA; Kathy called it irrelevant. Confirm it''s still sold.'),
      ('Labeled Chops', 'lb', 'mvm', null, 45, 'ok', null),
      ('Labeled Chops', 'lb', 'roll-stock', null, 25, 'ok', null),
      ('Labeled Chops', 'lb', 'jerky', null, 15, 'ok', null),
      ('Labeled Chops', 'lb', 'white', null, 12, 'ok', null),
      ('Labeled Chops', 'lb', 'baby', null, null, 'needs_checking', null),
      ('Short Loin', 'pcs', 'mvm', 16, null, 'ok', 'White 6 is from the sheet; in the recording Kathy also said White 4. Baby 2 from the recording.'),
      ('Short Loin', 'pcs', 'roll-stock', 12, null, 'ok', 'White 6 is from the sheet; in the recording Kathy also said White 4. Baby 2 from the recording.'),
      ('Short Loin', 'pcs', 'jerky', 8, null, 'ok', 'White 6 is from the sheet; in the recording Kathy also said White 4. Baby 2 from the recording.'),
      ('Short Loin', 'pcs', 'white', 6, null, 'ok', 'White 6 is from the sheet; in the recording Kathy also said White 4. Baby 2 from the recording.'),
      ('Short Loin', 'pcs', 'baby', 2, null, 'ok', 'White 6 is from the sheet; in the recording Kathy also said White 4. Baby 2 from the recording.'),
      ('BNLS Loins', 'pcs', 'mvm', 10, null, 'ok', null),
      ('BNLS Loins', 'pcs', 'roll-stock', 5, null, 'ok', null),
      ('BNLS Loins', 'pcs', 'jerky', 4, null, 'ok', null),
      ('BNLS Loins', 'pcs', 'white', 2, null, 'ok', null),
      ('BNLS Loins', 'pcs', 'baby', null, null, 'needs_checking', null),
      ('French Rack', 'pcs', 'mvm', 18, null, 'ok', null),
      ('French Rack', 'pcs', 'roll-stock', 10, null, 'ok', null),
      ('French Rack', 'pcs', 'jerky', 8, null, 'ok', null),
      ('French Rack', 'pcs', 'white', null, null, 'does_not_fit', null),
      ('French Rack', 'pcs', 'baby', null, null, 'does_not_fit', null),
      ('Cap On Rack', 'pcs', 'mvm', 10, null, 'ok', 'Kathy: an order of 12 = 10 + 2.'),
      ('Cap On Rack', 'pcs', 'roll-stock', 6, null, 'ok', 'Kathy: an order of 12 = 10 + 2.'),
      ('Cap On Rack', 'pcs', 'jerky', 6, null, 'ok', 'Kathy: an order of 12 = 10 + 2.'),
      ('Cap On Rack', 'pcs', 'white', 2, null, 'ok', 'Kathy: an order of 12 = 10 + 2.'),
      ('Cap On Rack', 'pcs', 'baby', null, null, 'needs_checking', 'Kathy: an order of 12 = 10 + 2.'),
      ('Chop Ready Rack', 'pcs', 'mvm', 16, null, 'ok', 'Sheet ''4 or 2'' = White 4, Baby 2. Kathy called this product not relevant in the recording; confirm it''s still sold.'),
      ('Chop Ready Rack', 'pcs', 'roll-stock', 12, null, 'ok', 'Sheet ''4 or 2'' = White 4, Baby 2. Kathy called this product not relevant in the recording; confirm it''s still sold.'),
      ('Chop Ready Rack', 'pcs', 'jerky', 8, null, 'ok', 'Sheet ''4 or 2'' = White 4, Baby 2. Kathy called this product not relevant in the recording; confirm it''s still sold.'),
      ('Chop Ready Rack', 'pcs', 'white', 4, null, 'ok', 'Sheet ''4 or 2'' = White 4, Baby 2. Kathy called this product not relevant in the recording; confirm it''s still sold.'),
      ('Chop Ready Rack', 'pcs', 'baby', 2, null, 'ok', 'Sheet ''4 or 2'' = White 4, Baby 2. Kathy called this product not relevant in the recording; confirm it''s still sold.'),
      ('Hind Shanks', 'packs', 'mvm', 16, null, 'ok', '2 shanks per pack; one pack counts as one.'),
      ('Hind Shanks', 'packs', 'roll-stock', 10, null, 'ok', '2 shanks per pack; one pack counts as one.'),
      ('Hind Shanks', 'packs', 'jerky', 8, null, 'ok', '2 shanks per pack; one pack counts as one.'),
      ('Hind Shanks', 'packs', 'white', 5, null, 'ok', '2 shanks per pack; one pack counts as one.'),
      ('Hind Shanks', 'packs', 'baby', null, null, 'needs_checking', '2 shanks per pack; one pack counts as one.'),
      ('Front Shanks', 'packs', 'mvm', 18, null, 'ok', 'Sheet says pcs; Kathy said change to packs. 2 per pack.'),
      ('Front Shanks', 'packs', 'roll-stock', 12, null, 'ok', 'Sheet says pcs; Kathy said change to packs. 2 per pack.'),
      ('Front Shanks', 'packs', 'jerky', 12, null, 'ok', 'Sheet says pcs; Kathy said change to packs. 2 per pack.'),
      ('Front Shanks', 'packs', 'white', 6, null, 'ok', 'Sheet says pcs; Kathy said change to packs. 2 per pack.'),
      ('Front Shanks', 'packs', 'baby', null, null, 'needs_checking', 'Sheet says pcs; Kathy said change to packs. 2 per pack.'),
      ('Labeled Hind Shanks', 'packs', 'mvm', 15, null, 'ok', 'MVM 15 vs 16 unlabeled; Kathy said labels don''t change the count. Confirm.'),
      ('Labeled Hind Shanks', 'packs', 'roll-stock', 10, null, 'ok', 'MVM 15 vs 16 unlabeled; Kathy said labels don''t change the count. Confirm.'),
      ('Labeled Hind Shanks', 'packs', 'jerky', 8, null, 'ok', 'MVM 15 vs 16 unlabeled; Kathy said labels don''t change the count. Confirm.'),
      ('Labeled Hind Shanks', 'packs', 'white', 5, null, 'ok', 'MVM 15 vs 16 unlabeled; Kathy said labels don''t change the count. Confirm.'),
      ('Labeled Hind Shanks', 'packs', 'baby', null, null, 'needs_checking', 'MVM 15 vs 16 unlabeled; Kathy said labels don''t change the count. Confirm.'),
      ('BNLS Legs', 'pcs', 'mvm', 6, null, 'ok', 'Kathy: an order of 8 = 6 + 2.'),
      ('BNLS Legs', 'pcs', 'roll-stock', 5, null, 'ok', 'Kathy: an order of 8 = 6 + 2.'),
      ('BNLS Legs', 'pcs', 'jerky', 4, null, 'ok', 'Kathy: an order of 8 = 6 + 2.'),
      ('BNLS Legs', 'pcs', 'white', 2, null, 'ok', 'Kathy: an order of 8 = 6 + 2.'),
      ('BNLS Legs', 'pcs', 'baby', null, null, 'needs_checking', 'Kathy: an order of 8 = 6 + 2.'),
      ('BI Legs', 'pcs', 'mvm', 4, null, 'ok', null),
      ('BI Legs', 'pcs', 'roll-stock', 2, null, 'ok', null),
      ('BI Legs', 'pcs', 'jerky', null, null, 'does_not_fit', null),
      ('BI Legs', 'pcs', 'white', null, null, 'does_not_fit', null),
      ('BI Legs', 'pcs', 'baby', null, null, 'does_not_fit', null),
      ('AO Legs', 'pcs', 'mvm', 4, null, 'ok', null),
      ('AO Legs', 'pcs', 'roll-stock', 2, null, 'ok', null),
      ('AO Legs', 'pcs', 'jerky', null, null, 'does_not_fit', null),
      ('AO Legs', 'pcs', 'white', null, null, 'does_not_fit', null),
      ('AO Legs', 'pcs', 'baby', null, null, 'does_not_fit', null),
      ('BNLS Shoulder', 'pcs', 'mvm', null, null, 'needs_checking', 'MVM sheet says 8-10/45#. Kathy also said 8 would weigh 55-60 lb; a box of 9 weighed 45.15 lb on 10/12. Needs one number. ''4 or 2'' = White 4, Baby 2.'),
      ('BNLS Shoulder', 'pcs', 'roll-stock', 8, null, 'ok', 'MVM sheet says 8-10/45#. Kathy also said 8 would weigh 55-60 lb; a box of 9 weighed 45.15 lb on 10/12. Needs one number. ''4 or 2'' = White 4, Baby 2.'),
      ('BNLS Shoulder', 'pcs', 'jerky', 5, null, 'ok', 'MVM sheet says 8-10/45#. Kathy also said 8 would weigh 55-60 lb; a box of 9 weighed 45.15 lb on 10/12. Needs one number. ''4 or 2'' = White 4, Baby 2.'),
      ('BNLS Shoulder', 'pcs', 'white', 4, null, 'ok', 'MVM sheet says 8-10/45#. Kathy also said 8 would weigh 55-60 lb; a box of 9 weighed 45.15 lb on 10/12. Needs one number. ''4 or 2'' = White 4, Baby 2.'),
      ('BNLS Shoulder', 'pcs', 'baby', 2, null, 'ok', 'MVM sheet says 8-10/45#. Kathy also said 8 would weigh 55-60 lb; a box of 9 weighed 45.15 lb on 10/12. Needs one number. ''4 or 2'' = White 4, Baby 2.'),
      ('BI Shoulder', 'pcs', 'mvm', 6, null, 'ok', 'Won''t fit a Baby box.'),
      ('BI Shoulder', 'pcs', 'roll-stock', 4, null, 'ok', 'Won''t fit a Baby box.'),
      ('BI Shoulder', 'pcs', 'jerky', 3, null, 'ok', 'Won''t fit a Baby box.'),
      ('BI Shoulder', 'pcs', 'white', 2, null, 'ok', 'Won''t fit a Baby box.'),
      ('BI Shoulder', 'pcs', 'baby', null, null, 'does_not_fit', 'Won''t fit a Baby box.'),
      ('Stew Meat', 'lb', 'mvm', null, 45, 'ok', null),
      ('Stew Meat', 'lb', 'roll-stock', null, 30, 'ok', null),
      ('Stew Meat', 'lb', 'jerky', null, 25, 'ok', null),
      ('Stew Meat', 'lb', 'white', null, 15, 'ok', null),
      ('Stew Meat', 'lb', 'baby', null, null, 'needs_checking', null),
      ('Ground Lamb 1 lb', 'packs', 'mvm', 45, null, 'ok', 'Sheet gives lb; 1 lb packs so count = lb.'),
      ('Ground Lamb 1 lb', 'packs', 'roll-stock', 30, null, 'ok', 'Sheet gives lb; 1 lb packs so count = lb.'),
      ('Ground Lamb 1 lb', 'packs', 'jerky', 25, null, 'ok', 'Sheet gives lb; 1 lb packs so count = lb.'),
      ('Ground Lamb 1 lb', 'packs', 'white', 15, null, 'ok', 'Sheet gives lb; 1 lb packs so count = lb.'),
      ('Ground Lamb 1 lb', 'packs', 'baby', null, null, 'needs_checking', 'Sheet gives lb; 1 lb packs so count = lb.'),
      ('Ground Lamb 5 lb', 'packs', 'mvm', 9, null, 'ok', null),
      ('Ground Lamb 5 lb', 'packs', 'roll-stock', 8, null, 'ok', null),
      ('Ground Lamb 5 lb', 'packs', 'jerky', 5, null, 'ok', null),
      ('Ground Lamb 5 lb', 'packs', 'white', 4, null, 'ok', null),
      ('Ground Lamb 5 lb', 'packs', 'baby', null, null, 'needs_checking', null),
      ('Le Trim', 'lb', 'mvm', null, 40, 'ok', null),
      ('Le Trim', 'lb', 'roll-stock', null, 30, 'ok', null),
      ('Le Trim', 'lb', 'jerky', null, 20, 'ok', null),
      ('Le Trim', 'lb', 'white', null, 10, 'ok', null),
      ('Le Trim', 'lb', 'baby', null, null, 'needs_checking', null),
      ('Trim 5 lb', 'packs', 'mvm', 8, null, 'ok', null),
      ('Trim 5 lb', 'packs', 'roll-stock', 6, null, 'ok', null),
      ('Trim 5 lb', 'packs', 'jerky', 4, null, 'ok', null),
      ('Trim 5 lb', 'packs', 'white', 2, null, 'ok', null),
      ('Trim 5 lb', 'packs', 'baby', null, null, 'needs_checking', null),
      ('Trim 6 lb', 'packs', 'mvm', 8, null, 'ok', 'MVM 8 x 6 lb = 48 lb, over the 45 lb cap; the cap makes it 7. Confirm.'),
      ('Trim 6 lb', 'packs', 'roll-stock', 6, null, 'ok', 'MVM 8 x 6 lb = 48 lb, over the 45 lb cap; the cap makes it 7. Confirm.'),
      ('Trim 6 lb', 'packs', 'jerky', 4, null, 'ok', 'MVM 8 x 6 lb = 48 lb, over the 45 lb cap; the cap makes it 7. Confirm.'),
      ('Trim 6 lb', 'packs', 'white', 2, null, 'ok', 'MVM 8 x 6 lb = 48 lb, over the 45 lb cap; the cap makes it 7. Confirm.'),
      ('Trim 6 lb', 'packs', 'baby', null, null, 'needs_checking', 'MVM 8 x 6 lb = 48 lb, over the 45 lb cap; the cap makes it 7. Confirm.'),
      ('Trim 10 lb', 'packs', 'mvm', 4, null, 'ok', 'Kathy: nothing in the Baby box.'),
      ('Trim 10 lb', 'packs', 'roll-stock', 4, null, 'ok', 'Kathy: nothing in the Baby box.'),
      ('Trim 10 lb', 'packs', 'jerky', 2, null, 'ok', 'Kathy: nothing in the Baby box.'),
      ('Trim 10 lb', 'packs', 'white', 1, null, 'ok', 'Kathy: nothing in the Baby box.'),
      ('Trim 10 lb', 'packs', 'baby', null, null, 'does_not_fit', 'Kathy: nothing in the Baby box.'),
      ('Organ Grind', 'pcs', 'mvm', null, null, 'does_not_fit', 'Sheet says 35 and 18; per the recording those are lb (a 35 lb Roll Stock box or an 18 lb Jerky box). One case per box. May be the same product as Pet Mix.'),
      ('Organ Grind', 'pcs', 'roll-stock', 1, null, 'ok', 'Sheet says 35 and 18; per the recording those are lb (a 35 lb Roll Stock box or an 18 lb Jerky box). One case per box. May be the same product as Pet Mix.'),
      ('Organ Grind', 'pcs', 'jerky', 1, null, 'ok', 'Sheet says 35 and 18; per the recording those are lb (a 35 lb Roll Stock box or an 18 lb Jerky box). One case per box. May be the same product as Pet Mix.'),
      ('Organ Grind', 'pcs', 'white', null, null, 'does_not_fit', 'Sheet says 35 and 18; per the recording those are lb (a 35 lb Roll Stock box or an 18 lb Jerky box). One case per box. May be the same product as Pet Mix.'),
      ('Organ Grind', 'pcs', 'baby', null, null, 'does_not_fit', 'Sheet says 35 and 18; per the recording those are lb (a 35 lb Roll Stock box or an 18 lb Jerky box). One case per box. May be the same product as Pet Mix.'),
      ('Denver Ribs', 'lb', 'mvm', null, null, 'needs_checking', 'Kathy didn''t know.'),
      ('Denver Ribs', 'lb', 'roll-stock', null, null, 'needs_checking', 'Kathy didn''t know.'),
      ('Denver Ribs', 'lb', 'jerky', null, null, 'needs_checking', 'Kathy didn''t know.'),
      ('Denver Ribs', 'lb', 'white', null, null, 'needs_checking', 'Kathy didn''t know.'),
      ('Denver Ribs', 'lb', 'baby', null, null, 'needs_checking', 'Kathy didn''t know.'),
      ('Heart', 'packs', 'mvm', null, null, 'does_not_fit', 'Needs a weight per pack for the lb limit.'),
      ('Heart', 'packs', 'roll-stock', null, null, 'does_not_fit', 'Needs a weight per pack for the lb limit.'),
      ('Heart', 'packs', 'jerky', null, 25, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Heart', 'packs', 'white', null, 15, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Heart', 'packs', 'baby', null, null, 'needs_checking', 'Needs a weight per pack for the lb limit.'),
      ('Liver', 'packs', 'mvm', null, 45, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Liver', 'packs', 'roll-stock', null, 30, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Liver', 'packs', 'jerky', null, 25, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Liver', 'packs', 'white', null, 15, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Liver', 'packs', 'baby', null, null, 'needs_checking', 'Needs a weight per pack for the lb limit.'),
      ('Kidney', 'packs', 'mvm', null, null, 'does_not_fit', 'Needs a weight per pack for the lb limit.'),
      ('Kidney', 'packs', 'roll-stock', null, null, 'does_not_fit', 'Needs a weight per pack for the lb limit.'),
      ('Kidney', 'packs', 'jerky', null, 25, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Kidney', 'packs', 'white', null, 15, 'ok', 'Needs a weight per pack for the lb limit.'),
      ('Kidney', 'packs', 'baby', null, null, 'needs_checking', 'Needs a weight per pack for the lb limit.'),
      ('Necks', 'pcs', 'mvm', null, 45, 'ok', 'Needs a weight per neck for the MVM lb limit.'),
      ('Necks', 'pcs', 'roll-stock', 12, null, 'ok', 'Needs a weight per neck for the MVM lb limit.'),
      ('Necks', 'pcs', 'jerky', 12, null, 'ok', 'Needs a weight per neck for the MVM lb limit.'),
      ('Necks', 'pcs', 'white', 6, null, 'ok', 'Needs a weight per neck for the MVM lb limit.'),
      ('Necks', 'pcs', 'baby', null, null, 'needs_checking', 'Needs a weight per neck for the MVM lb limit.'),
      ('Bones', 'packs', 'mvm', null, 45, 'ok', '5 lb bags: MVM 9 bags, Jerky 4 bags.'),
      ('Bones', 'packs', 'roll-stock', null, null, 'does_not_fit', '5 lb bags: MVM 9 bags, Jerky 4 bags.'),
      ('Bones', 'packs', 'jerky', null, 20, 'ok', '5 lb bags: MVM 9 bags, Jerky 4 bags.'),
      ('Bones', 'packs', 'white', null, null, 'does_not_fit', '5 lb bags: MVM 9 bags, Jerky 4 bags.'),
      ('Bones', 'packs', 'baby', null, null, 'does_not_fit', '5 lb bags: MVM 9 bags, Jerky 4 bags.'),
      ('Pet Mix', 'lb', 'mvm', null, null, 'does_not_fit', 'Always Roll Stock 35 lb or Jerky 18 lb. May be the same product as Organ Grind.'),
      ('Pet Mix', 'lb', 'roll-stock', null, 35, 'ok', 'Always Roll Stock 35 lb or Jerky 18 lb. May be the same product as Organ Grind.'),
      ('Pet Mix', 'lb', 'jerky', null, 18, 'ok', 'Always Roll Stock 35 lb or Jerky 18 lb. May be the same product as Organ Grind.'),
      ('Pet Mix', 'lb', 'white', null, null, 'does_not_fit', 'Always Roll Stock 35 lb or Jerky 18 lb. May be the same product as Organ Grind.'),
      ('Pet Mix', 'lb', 'baby', null, null, 'does_not_fit', 'Always Roll Stock 35 lb or Jerky 18 lb. May be the same product as Organ Grind.'),
      ('Tongue', 'packs', 'mvm', null, null, 'does_not_fit', 'Kathy: tongue goes in a White box, 10 packs.'),
      ('Tongue', 'packs', 'roll-stock', null, null, 'does_not_fit', 'Kathy: tongue goes in a White box, 10 packs.'),
      ('Tongue', 'packs', 'jerky', null, null, 'does_not_fit', 'Kathy: tongue goes in a White box, 10 packs.'),
      ('Tongue', 'packs', 'white', 10, null, 'ok', 'Kathy: tongue goes in a White box, 10 packs.'),
      ('Tongue', 'packs', 'baby', null, null, 'needs_checking', 'Kathy: tongue goes in a White box, 10 packs.')
  ) as v(product, unit, box_type, max_count, max_lb, status, note)
  join public.products p on p.name = v.product and p.active
  on conflict (product_id, box_type_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$fn$;
revoke all on function public.load_box_limits() from public, anon, authenticated;
grant execute on function public.load_box_limits() to service_role;

select public.load_box_limits();
