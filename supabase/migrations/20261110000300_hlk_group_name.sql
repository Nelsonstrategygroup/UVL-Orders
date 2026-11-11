-- The "packed in one box" group of Heart, Liver and Kidney is called HLK, not
-- Organs (Lucas, 11/11/26): "Organs" read like a product next to the real
-- product Organ Grind, which is not in the group and is not touched. Only the
-- label in Setup > Products ("Packed in one box with") changes. Already run
-- on the live database by hand on 11/11/26; this keeps a rebuilt database the
-- same, and changes nothing when run again.

update public.products set packed_with = 'HLK' where packed_with = 'Organs';
