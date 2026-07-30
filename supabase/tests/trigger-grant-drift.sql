-- Put bump_game_state_version() into the ACL production has, so
-- 20260730072329_revoke_anon_on_bump_game_state_version.sql has something real
-- to repair.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project.
--
-- The harness creates this function before it creates the Supabase roles, so it
-- never picks the grant up from default privileges the way production did, and
-- "create or replace" would not help: replacing a function preserves its ACL
-- rather than rebuilding it. Granting explicitly is the honest way to reproduce
-- the state. Read off production on 2026-07-30:
--
--   =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- The bare leading "=X/postgres" is the PUBLIC grant CREATE FUNCTION hands out
-- by itself, which is why the repair has to name PUBLIC as well as anon.

grant execute on function public.bump_game_state_version()
  to anon, authenticated, service_role, public;

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

select t('trigger drift :: bump_game_state_version is anon-executable before the repair',
         has_function_privilege('anon', 'public.bump_game_state_version()', 'EXECUTE'),
         'ACL: ' || coalesce(
           (select array_to_string(proacl, ' | ') from pg_proc
             where oid = 'public.bump_game_state_version()'::regprocedure), '(null)'));
