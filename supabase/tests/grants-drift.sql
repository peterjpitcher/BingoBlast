-- Put the throwaway database into the state production is actually in, so the
-- hardening migration has something real to repair.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project.
--
-- A fresh build from this repo now gets the hardened end state straight out of
-- 20260729120000_atomic_host_mutations.sql, which is correct but makes
-- 20260730130000_revoke_anon_host_rpcs.sql a no-op and the run worthless as
-- evidence. Production is different: it applied that migration BEFORE the anon
-- revoke was folded in, so it carries anon=X/postgres on all four functions.
-- This file recreates that drift, in the two shapes production has it.
--
-- Shape 1: the plain anon grant on all four, exactly as ALTER DEFAULT PRIVILEGES
-- left it when the functions were created.
--
-- Shape 2: an eight-argument record_winner_atomic. Production is on the version
-- winner_idempotency_key installed, which added p_client_request_id, while this
-- repo's migration history still builds the seven-argument one. That mismatch is
-- the reason 20260730130000 loops over pg_proc instead of naming signatures: a
-- pinned REVOKE would raise "function does not exist" against production. The
-- stub below has no default on its last argument, so seven-named-argument calls
-- in the host flow test still resolve unambiguously to the real function.

grant execute on function public.assert_is_host() to anon;
grant execute on function public.call_next_number(uuid, int) to anon;
grant execute on function public.void_last_number(uuid) to anon;
grant execute on function public.record_winner_atomic(
  uuid, uuid, public.win_stage, text, boolean, boolean, boolean) to anon;

-- Picks up the anon grant on its own from the default privileges the harness
-- installed. Nothing grants to it explicitly, which is the whole point.
create or replace function public.record_winner_atomic(
  p_session_id uuid,
  p_game_id uuid,
  p_stage public.win_stage,
  p_prize_description text,
  p_prize_given boolean,
  p_force_snowball_jackpot boolean,
  p_snowball_eligible boolean,
  p_client_request_id uuid
) returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'stub overload: present for grant coverage only';
end;
$$;

-- Mirrors what winner_idempotency_key did to the real eight-argument function in
-- production. CREATE FUNCTION hands PUBLIC an EXECUTE grant of its own, on top
-- of whatever ALTER DEFAULT PRIVILEGES adds, and production revoked it. Without
-- this line the stub would be harsher than production rather than equal to it.
revoke all on function public.record_winner_atomic(
  uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from public;

-- ---------------------------------------------------------------------------
-- Prove the drift landed. If these fail, the repair phase that follows would
-- pass without having done anything.
-- ---------------------------------------------------------------------------
create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

select t('drift :: anon CAN execute all five host RPC signatures before the repair',
         count(*) = 5 and count(*) filter (where anon_exec) = 5,
         'signatures=' || count(*)
           || ' anon_executable=' || count(*) filter (where anon_exec)
           || ' -> ' || string_agg(signature, ' | ') filter (where anon_exec))
  from (
    select p.oid::regprocedure::text as signature,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and p.proname in ('assert_is_host', 'call_next_number',
                         'void_last_number', 'record_winner_atomic')
  ) s;

select t('drift :: the eight-argument record_winner_atomic exists, as in production',
         count(*) = 1,
         'signatures: ' || coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ' | '), 'none'))
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = 'record_winner_atomic'
   and p.pronargs = 8;

-- ---------------------------------------------------------------------------
-- And prove the drift is inert, which is the reason this is defence in depth
-- rather than an incident. With EXECUTE granted, anon still gets nowhere:
-- assert_is_host() reads auth.uid(), which is null without a JWT, so no profiles
-- row matches. This reproduces in the container what was checked against
-- production on 2026-07-30, and it is what makes the change safe to schedule
-- rather than hotfix.
--
-- test.uid is left UNSET here on purpose. Setting it would fake a JWT that anon
-- can never actually present, and would prove the opposite of what is wanted.
-- ---------------------------------------------------------------------------
grant select, insert on table test_results to anon;
grant usage, select on sequence test_results_seq_seq to anon;
grant execute on function t(text, boolean, text) to anon;

reset test.uid;
set role anon;

do $$
declare
  v_sqlstate text;
  v_message text;
begin
  begin
    perform public.record_winner_atomic(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '66666666-6666-4666-8666-666666666666'::uuid,
      'Line'::public.win_stage, null, false, false, false);
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  perform t('drift :: the anon grant is inert, assert_is_host still refuses',
            v_message = 'unauthorized: host or admin role required',
            'SQLSTATE ' || coalesce(v_sqlstate, 'none, the call SUCCEEDED')
              || ': ' || coalesce(v_message, 'no error raised'));
end
$$;

reset role;
