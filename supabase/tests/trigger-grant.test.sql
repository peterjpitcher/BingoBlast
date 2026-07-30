-- Assertions for 20260730072329_revoke_anon_on_bump_game_state_version.sql.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project: it updates game_states.
--
-- The grant assertions are the easy half. The one that actually matters is that
-- the BEFORE UPDATE trigger still bumps state_version afterwards, because
-- state_version is what every display and player screen uses to discard stale
-- Realtime payloads. If revoking EXECUTE stopped the trigger firing, the public
-- screens would silently freeze, and the grant check alone would not notice.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Grants. End state must match the two siblings that
-- lockdown_admin_functions_2026_05_27 hardened: postgres and service_role only.
-- ---------------------------------------------------------------------------
select t('trigger grant :: no role can EXECUTE bump_game_state_version',
         not has_function_privilege('anon', oid, 'EXECUTE')
           and not has_function_privilege('authenticated', oid, 'EXECUTE'),
         'anon=' || has_function_privilege('anon', oid, 'EXECUTE')
           || ' authenticated=' || has_function_privilege('authenticated', oid, 'EXECUTE')
           || ' | ACL: ' || coalesce(array_to_string(proacl, ' | '), '(null)'))
  from pg_proc where oid = 'public.bump_game_state_version()'::regprocedure;

select t('trigger grant :: PUBLIC holds no EXECUTE on bump_game_state_version',
         proacl is not null and not (proacl::text[] && array['=X/postgres']),
         'ACL: ' || coalesce(array_to_string(proacl, ' | '), '(null, which means PUBLIC still has it)'))
  from pg_proc where oid = 'public.bump_game_state_version()'::regprocedure;

-- ---------------------------------------------------------------------------
-- Behaviour. The trigger runs with its own rights, not the caller's, so
-- state_version must still advance on every update to game_states.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before bigint;
  v_after bigint;
begin
  select state_version into v_before
    from public.game_states where game_id = '77777777-7777-4777-8777-777777777777';

  update public.game_states
     set on_break = not coalesce(on_break, false)
   where game_id = '77777777-7777-4777-8777-777777777777';

  select state_version into v_after
    from public.game_states where game_id = '77777777-7777-4777-8777-777777777777';

  perform t('trigger grant :: the trigger still bumps state_version after the revoke',
            v_after = v_before + 1,
            'state_version ' || v_before || ' -> ' || v_after);
end
$$;

-- And the public mirror still tracks it, which is what /display and /player read.
select t('trigger grant :: game_states_public still mirrors the bumped state_version',
         p.state_version = g.state_version,
         'private=' || g.state_version || ' public=' || p.state_version)
  from public.game_states g
  join public.game_states_public p on p.game_id = g.game_id
 where g.game_id = '77777777-7777-4777-8777-777777777777';

-- ---------------------------------------------------------------------------
-- And the grant was never usable in the first place: a function returning
-- trigger cannot be called directly, even as superuser. This is why the change
-- carries no behavioural risk, stated as an assertion rather than a claim.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sqlstate text;
  v_message text;
begin
  begin
    execute 'select public.bump_game_state_version()';
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;

  perform t('trigger grant :: a trigger function cannot be called directly anyway',
            v_message is not null,
            'SQLSTATE ' || coalesce(v_sqlstate, 'none, the call SUCCEEDED')
              || ': ' || coalesce(v_message, 'no error raised'));
end
$$;
