-- The service role (used only by server-side code and scripts like `npm run seed`)
-- bypasses Row Level Security, but still needs table privileges. The earlier
-- migrations granted only `authenticated`, so give `service_role` the same tables.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Tables added by later migrations get the same grant automatically.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
