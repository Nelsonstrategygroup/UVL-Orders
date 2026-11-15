-- Chain prices (migration 20261114000400): price_on() uses the store's own
-- price, else its chain's, else the default.

begin;
select plan(7);

insert into public.products (id, name, unit, group_name, sort) values ('chain-prod', 'Chain Test Rack', 'lb', 'Racks', 9999)
on conflict (id) do nothing;
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000c0a01', 'Chain Test Co');
insert into public.customers (id, name, parent_customer_id) values
  ('00000000-0000-4000-8000-0000000c0a02', 'Store A', '00000000-0000-4000-8000-0000000c0a01'),
  ('00000000-0000-4000-8000-0000000c0a03', 'Store B', '00000000-0000-4000-8000-0000000c0a01');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000c0a04', 'Solo Market');

insert into public.prices (product_id, customer_id, price, effective_from) values
  ('chain-prod', null, 10, '2099-01-01'),
  ('chain-prod', '00000000-0000-4000-8000-0000000c0a01', 12, '2099-02-01'),
  ('chain-prod', '00000000-0000-4000-8000-0000000c0a01', 13, '2099-04-01'),
  ('chain-prod', '00000000-0000-4000-8000-0000000c0a03', 11, '2099-02-01');

select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a02', '2099-01-15'), 10.0000,
  'before the chain price starts, a store gets the default');
select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a02', '2099-03-01'), 12.0000,
  'a store gets its chain''s price');
select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a02', '2099-05-01'), 13.0000,
  'the chain''s newest price on the date');
select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a03', '2099-05-01'), 11.0000,
  'a store''s own price wins over the chain''s, even a newer one');
select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a04', '2099-05-01'), 10.0000,
  'a customer with no chain gets the default');
select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a01', '2099-05-01'), 13.0000,
  'the chain itself gets its own price');
select is(public.price_on('chain-prod', '00000000-0000-4000-8000-0000000c0a02', '2098-12-01'), null,
  'no price at all: Price needed');

select * from finish();
rollback;
