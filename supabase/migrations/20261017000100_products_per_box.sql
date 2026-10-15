-- How many of a product fit in one box (in the product's own unit: pieces,
-- packs, or pounds). Products never share a box, so an order needs
-- ceil(amount / per_box) boxes for each product. Null: not known yet.
-- products already has RLS and its policies; adding a column changes neither.

alter table public.products
  add column per_box numeric check (per_box is null or per_box > 0);

comment on column public.products.per_box is
  'How many fit in one box, in the product''s own unit. Products never share a box. Null until Kathy sets it in Setup.';
