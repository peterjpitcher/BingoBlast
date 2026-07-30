-- Migration: finish the trigger-function lockdown that missed one.
--
-- lockdown_admin_functions_2026_05_27 (production version 20260527080524) took
-- EXECUTE off two trigger functions with the comment "no direct RPC callers
-- needed; triggers fire regardless of grant":
--
--   REVOKE EXECUTE ON FUNCTION public.handle_new_user()          FROM anon, authenticated, PUBLIC;
--   REVOKE EXECUTE ON FUNCTION public.sync_game_states_public()  FROM anon, authenticated, PUBLIC;
--
-- bump_game_state_version() is the third trigger function in this schema and it
-- was not on that list, because 20260430094038_add_state_version.sql created it
-- three days after that lockdown ran. It has carried the default-privilege grant
-- ever since. In production it reads:
--
--   =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- against its two siblings, which read postgres=X | service_role=X. This
-- migration closes that gap and leaves all three identical.
--
-- Risk is as close to nil as a grant change gets. A function that RETURNS
-- trigger cannot be invoked directly at all: Postgres rejects it with "trigger
-- functions can only be called as trigger triggers", and PostgREST does not
-- expose it as an RPC. The BEFORE UPDATE trigger on game_states runs with the
-- trigger's own rights and does not consult the caller's EXECUTE grant, so
-- state_version keeps being bumped exactly as before. Nothing in src/ calls it.
-- The grant was never usable; it was only ever noise on the security advisor.
--
-- Both PUBLIC and anon, not just anon. CREATE FUNCTION grants EXECUTE to PUBLIC
-- on its own and ALTER DEFAULT PRIVILEGES adds the named anon grant on top, and
-- anon is a member of PUBLIC, so revoking one and not the other leaves the
-- function reachable regardless. The leading bare "=X/postgres" in the ACL above
-- is that PUBLIC grant. authenticated goes too, matching the siblings: no role
-- has any business calling a trigger function by hand.
--
-- Also folded into 20260430094038_add_state_version.sql, which is where the
-- function is created, so a database built from this repo never has the grant in
-- the first place. This file is for the production database, which does.
--
-- Verified against a throwaway postgres:17 container: bash supabase/tests/run.sh

revoke execute on function public.bump_game_state_version() from anon, authenticated, public;

-- Fail loudly rather than silently reporting success, matching the shape used
-- for the host RPCs. has_function_privilege accounts for anything reachable
-- through PUBLIC or role membership, which a proacl scan on its own would miss.
do $$
begin
  if has_function_privilege('anon', 'public.bump_game_state_version()', 'EXECUTE') then
    raise exception 'anon still holds EXECUTE on public.bump_game_state_version()';
  end if;
end
$$;
