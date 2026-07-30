-- RECORDED AFTER THE FACT. This migration was applied to production (project
-- bcmorqsgeumtmhvctvgu) on 2026-07-30 as version 20260730070705, name
-- revoke_anon_execute_on_host_rpcs, by a separate session, and had no file in
-- this repository. The body below is the SQL that ran, copied verbatim out of
-- supabase_migrations.schema_migrations; only this note is new.
--
-- It is checked in because prod-only migrations are the root cause of the very
-- bug it fixes: lockdown_admin_functions_2026_05_27 hardened the admin RPCs in
-- production and was never committed, so when the host RPCs were written months
-- later there was nothing in the repo to copy the treatment from, and they
-- shipped anon-callable. Leaving this one unrecorded would set the same trap for
-- whoever writes the next batch of functions.
--
-- It is a no-op on production, where it has already run, and a no-op on a fresh
-- database built from this repo, because 20260729120000_atomic_host_mutations.sql
-- now revokes anon inline on each of the four. Both were verified against a
-- throwaway postgres:17 container: bash supabase/tests/run.sh.
--
-- Still outstanding, and deliberately not fixed here: nothing stops the next
-- "create function" in this schema picking the anon grant straight back up. See
-- the recommendation about a repo convention for that.
--
-- ===========================================================================
-- Applied SQL follows, unchanged.
-- ===========================================================================

-- Migration: stop the four host RPCs being callable without signing in.
--
-- The Supabase security advisor flags all four under
-- anon_security_definer_function_executable: assert_is_host, call_next_number,
-- void_last_number and record_winner_atomic are reachable by the anon role at
-- /rest/v1/rpc/<name>.
--
-- Cause. Supabase ships default privileges that grant EXECUTE on new
-- public-schema functions to anon, and the "revoke all on function ... from
-- public" in 20260729120000_atomic_host_mutations.sql does not remove an
-- explicit grant to a named role. PUBLIC and anon are different grantees.
-- Confirmed by reading the live ACLs: these four carry "anon=X/postgres" while
-- the older admin RPCs (assert_is_admin, delete_game_safe, delete_session_safe,
-- reset_session_safe, update_game_safe) do not. The inconsistency is the tell.
--
-- Not a live hole, which is why this is a tidy-up rather than an incident. Every
-- one of these functions calls assert_is_host() first, and that raises
-- 'unauthorized: host or admin role required' when auth.uid() is null, as it
-- always is for anon. This closes the door rather than patching a breach.
--
-- Safe for the app. All four are called only from src/app/host/actions.ts, which
-- is 'use server' and uses the cookie-based client, so the caller is the
-- authenticated role. The public surfaces (/display and /player) call no RPC at
-- all: they read game_states_public and subscribe to Realtime. Verified before
-- writing this. authenticated and service_role keep their grants.
--
-- Why this iterates pg_proc instead of naming signatures. record_winner_atomic
-- has drifted: production carries an eighth parameter (p_client_request_id
-- uuid) added by a migration that has no file in this repo, while
-- 20260729120000_atomic_host_mutations.sql still creates the seven-parameter
-- version. A hard-coded signature would therefore fail on one side or the
-- other. Looping over the names covers whichever signatures exist, including
-- both at once if the drift ever leaves two overloads behind. The same loop is
-- re-runnable and is a no-op once the grants are gone.
--
-- Deliberately NOT touched: public.create_table_booking_transaction, which is
-- also anon-executable and security definer, and which the advisor flags too. It
-- belongs to no code in this repository and looks like it arrived from another
-- project sharing this database. Revoking a grant on a function whose callers
-- are unknown is how you cause an outage, so it is reported instead.

do $$
declare
  v_fn record;
  v_revoked int := 0;
begin
  for v_fn in
    select p.oid::regprocedure as signature
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in (
         'assert_is_host',
         'call_next_number',
         'void_last_number',
         'record_winner_atomic'
       )
     order by p.proname
  loop
    execute format('revoke all on function %s from anon', v_fn.signature);
    v_revoked := v_revoked + 1;
    raise notice 'revoked anon EXECUTE on %', v_fn.signature;
  end loop;

  -- A count of zero means the names were wrong or the functions are missing,
  -- which is worth failing on rather than reporting a silent success.
  if v_revoked = 0 then
    raise exception 'revoke_anon_execute: matched no functions, check the name list';
  end if;

  raise notice 'revoked anon EXECUTE on % function(s)', v_revoked;
end;
$$;
