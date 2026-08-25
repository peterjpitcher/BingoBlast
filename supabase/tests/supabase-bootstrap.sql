-- Supabase bootstrap for the full-migration-replay suite (SUITE D in run.sh).
--
-- WHY THIS EXISTS
--   supabase/migrations/20251201000000_baseline_schema.sql documents that it
--   assumes the Supabase-managed `auth` schema and the anon / authenticated /
--   service_role roles already exist. A bare postgres:17 container has none of
--   that, so a replay of the repo's migration history needs this file first.
--
--   It is NOT production DDL and is never applied to a real project. It exists
--   only so the replay starts from something shaped like a fresh Supabase
--   project rather than from something friendlier.
--
-- FIDELITY MATTERS MORE THAN CONVENIENCE
--   The default privileges below are the ones production actually carries, read
--   from pg_default_acl on bcmorqsgeumtmhvctvgu on 2026-08-25:
--
--     owner          schema  objtype  acl
--     postgres       public  f        {postgres=X, anon=X, authenticated=X, service_role=X}
--     postgres       public  r        {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
--     postgres       public  S        {postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}
--     supabase_admin public  f        {postgres=X, anon=X, authenticated=X, service_role=X}
--     supabase_admin public  r        {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
--     supabase_admin public  S        {postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}
--
--   Two owners, because it does not matter which of them creates an object: the
--   grant is handed out either way. Without reproducing BOTH rows the container
--   is friendlier than production and every grant assertion in the replay suite
--   would pass for the wrong reason. That is the exact trap that let the host
--   RPCs ship anon-callable once already.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login superuser createrole createdb replication bypassrls password 'test';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'test';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The auth schema, as much of it as the migrations touch
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, postgres;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- auth.uid() and auth.role() read session settings so a test can act as a given
-- user. On a real project these read the JWT claims; the shape of the answer is
-- what the migrations depend on, not the source.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default privileges, reproduced from production for both owners
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to anon, authenticated, service_role;
