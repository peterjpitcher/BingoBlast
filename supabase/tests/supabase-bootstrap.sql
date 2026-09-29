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
--
-- TWO WORLDS, BECAUSE SUPABASE CHANGED ITS DEFAULTS
--   A project created today does not get those defaults. Read from a fresh
--   `supabase start` (CLI 2.108, image postgres 17.6.1.139) on 2026-09-29,
--   before any migration ran:
--
--     owner          schema  objtype  acl
--     postgres       public  f        {postgres=X}
--     postgres       public  r        {postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}
--     postgres       public  S        {postgres=rwU, anon=w, authenticated=w, service_role=w}
--     supabase_admin public  (unchanged from the production rows above)
--
--   So a table a migration creates without stating grants is unreadable by every
--   API role, service_role included. That is how game_states_public and
--   session_reset_log came out on a rebuilt project, and the pub TV failed with
--   42501 while this suite, bootstrapped only with the production defaults,
--   still passed.
--
--   Each world catches what the other cannot. The production defaults are
--   generous, so they catch a migration that forgets to REVOKE. The current
--   defaults are strict, so they catch a migration that forgets to GRANT.
--   run.sh replays the whole history under both, choosing with
--   `-v current_defaults=on` or `off`. Omitting it means production.

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
-- Default privileges for postgres: production's, or the current image's
-- ---------------------------------------------------------------------------
\if :{?current_defaults}
\else
  \set current_defaults off
\endif

\if :current_defaults
  -- Current Supabase image. Functions get no API-role grant of their own (PUBLIC
  -- still has EXECUTE from the built-in global default), tables get only the
  -- privileges RLS does not govern, and sequences get UPDATE alone.
  alter default privileges for role postgres in schema public
    grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public
    grant update on sequences to anon, authenticated, service_role;
\else
  -- Production, as read on 2026-08-25.
  alter default privileges for role postgres in schema public
    grant execute on functions to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public
    grant all on sequences to anon, authenticated, service_role;
\endif

-- ---------------------------------------------------------------------------
-- Default privileges for supabase_admin: the same in both worlds
-- ---------------------------------------------------------------------------
alter default privileges for role supabase_admin in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to anon, authenticated, service_role;
