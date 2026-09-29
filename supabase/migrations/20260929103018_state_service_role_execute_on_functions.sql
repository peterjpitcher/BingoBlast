-- State service_role's EXECUTE on the eight functions that only inherited it.
--
-- WHY
--   On production every one of the twenty functions in public is executable by
--   service_role (read-only on bcmorqsgeumtmhvctvgu, 29 September 2026). For
--   twelve of them a migration grants it. For the eight below nothing does: each
--   migration revoked PUBLIC and granted authenticated, or nobody, and
--   service_role came from the schema's default privileges, which on production
--   hand it EXECUTE on every new function.
--
--   The current Supabase image's defaults do not. Replaying every migration from
--   empty under them (suite E in supabase/tests/run.sh) leaves these eight
--   without service_role, so a project rebuilt from this repository would not
--   match the one it is meant to rebuild. No app path needs it today: the service
--   role is used only by startGame writing game_states, where a trigger's
--   function is not checked for EXECUTE, and by /api/setup on profiles. It is
--   stated anyway, because a restore from these migrations should produce
--   production's grants, not a quieter variant that breaks the first time a
--   server path calls one of these with the service key.
--
--     assert_is_admin()             bump_game_state_version()
--     delete_game_safe(uuid)        delete_session_safe(uuid)
--     handle_new_user()             sync_game_states_public()
--     sync_prize_shares()           update_game_safe(... nine arguments ...)
--
--   Only service_role gains anything, and only on a fresh build. anon and
--   authenticated are not touched: both already match production in both worlds.
--
-- EFFECT ON PRODUCTION
--   None. service_role already holds EXECUTE on all eight, granted by
--   postgres, so each GRANT finds the privilege present and changes nothing.
--
-- GUARDED
--   It refuses if any of the eight is missing, rather than skipping it, and then
--   checks that every function in public is executable by service_role and that
--   none of the eight is executable by anon, raising (and so rolling back) if
--   either fails.
--
-- IDEMPOTENT: yes. Granting a privilege already held is a no-op.
--
-- ROLLBACK
--   On production: nothing to do, since nothing changed.
--   On a fresh build, to return to the inherited state:
--     revoke execute on function public.assert_is_admin(), public.bump_game_state_version(),
--       public.delete_game_safe(uuid), public.delete_session_safe(uuid),
--       public.handle_new_user(), public.sync_game_states_public(),
--       public.sync_prize_shares(),
--       public.update_game_safe(uuid, text, integer, text, text, public.game_type, uuid, jsonb, jsonb)
--     from service_role;
--   Do NOT run that on production: there it would take away a grant it has held
--   all along.

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.assert_is_admin()',
    'public.bump_game_state_version()',
    'public.delete_game_safe(uuid)',
    'public.delete_session_safe(uuid)',
    'public.handle_new_user()',
    'public.sync_game_states_public()',
    'public.sync_prize_shares()',
    'public.update_game_safe(uuid, text, integer, text, text, public.game_type, uuid, jsonb, jsonb)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'state_service_role_execute: % does not exist', v_fn;
    end if;
  end loop;
end;
$$;

grant execute on function
  public.assert_is_admin(),
  public.bump_game_state_version(),
  public.delete_game_safe(uuid),
  public.delete_session_safe(uuid),
  public.handle_new_user(),
  public.sync_game_states_public(),
  public.sync_prize_shares(),
  public.update_game_safe(uuid, text, integer, text, text, public.game_type, uuid, jsonb, jsonb)
to service_role;

-- Prove the end state rather than trusting the statement above.
do $$
declare
  v_missing text;
  v_anon text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_missing
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not has_function_privilege('service_role', p.oid, 'EXECUTE');

  if v_missing is not null then
    raise exception 'state_service_role_execute: service_role cannot execute %', v_missing;
  end if;

  select string_agg(f, ', ')
    into v_anon
    from unnest(array[
      'public.assert_is_admin()',
      'public.bump_game_state_version()',
      'public.delete_game_safe(uuid)',
      'public.delete_session_safe(uuid)',
      'public.handle_new_user()',
      'public.sync_game_states_public()',
      'public.sync_prize_shares()',
      'public.update_game_safe(uuid, text, integer, text, text, public.game_type, uuid, jsonb, jsonb)'
    ]) f
   where has_function_privilege('anon', f, 'EXECUTE');

  if v_anon is not null then
    raise exception 'state_service_role_execute: anon can execute %', v_anon;
  end if;
end;
$$;
