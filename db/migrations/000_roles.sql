-- Application role.
--
-- The API never connects as the database owner. It connects as rw_app, a role with
-- NOBYPASSRLS, so the row level security policies added in 002_rls.sql apply to every
-- statement the backend runs. A bug in the API cannot read another user's messages,
-- because the database itself refuses.
--
-- Run with:  psql "$DATABASE_ADMIN_URL" -v app_password="$APP_DB_PASSWORD" -f 000_roles.sql

-- Create the role only if it is missing. \gexec runs the string the SELECT produced,
-- which is how we get a password literal into a CREATE ROLE without concatenating SQL
-- by hand: format(%L) quotes and escapes it for us.
select format('create role rw_app login password %L', :'app_password')
where not exists (select 1 from pg_roles where rolname = 'rw_app')\gexec

-- Applied on every run, so the role can never drift into extra privileges.
select format('alter role rw_app with login password %L', :'app_password')\gexec

alter role rw_app
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;  -- the whole point: this role is always subject to RLS

-- No one else should be able to create objects in the public schema.
revoke create on schema public from public;
