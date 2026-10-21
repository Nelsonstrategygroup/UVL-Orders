-- Undo 20261021000100_box_limits.sql (box types, box limits, 45 lb cap,
-- label names, label print fingerprint). Values from
-- backups/20261021T053639Z_*.json. Never touches orders or order lines.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261021000100_revert.sql

begin;

drop function if exists public.load_box_limits();
drop table if exists public.product_box_limits;
drop table if exists public.box_types;

alter table public.weeks
  drop column if exists labels_hash,
  drop column if exists labels_printed_at,
  drop column if exists labels_printed_by;
alter table public.app_settings drop column if exists box_cap_lb;
alter table public.products drop column if exists label_name;

-- The five names as they were before.
update public.products set name = 'Boneless Loins' where id = 'cp-boneless-loins' and name = 'BNLS Loins';
update public.products set name = 'Rack' where id = 'cp-cap-on-rack' and name = 'Cap On Rack';
update public.products set name = 'BLS Legs' where id = 'cp-bls-legs' and name = 'BNLS Legs';
update public.products set name = 'BLS Shoulder' where id = 'cp-bls-shoulder' and name = 'BNLS Shoulder';
update public.products set name = 'Pet' where id = 'cp-pet' and name = 'Pet Mix';

delete from supabase_migrations.schema_migrations where version = '20261021000100';

commit;
