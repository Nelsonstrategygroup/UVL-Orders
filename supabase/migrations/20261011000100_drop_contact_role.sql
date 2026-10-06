-- The free-text contact role was replaced by roles (orders, receiving,
-- billing) in 20261010000100. Now that the screens use roles, drop it.
alter table public.customer_contacts drop column role;
