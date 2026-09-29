-- State the grants on game_states_public and session_reset_log instead of
-- inheriting them.
--
-- WHY
--   Both tables were created by migrations that never said who may use them, so
--   their grants came from the schema's default privileges. Production was built
--   when those defaults handed anon, authenticated and service_role every table
--   privilege, so it works. A project rebuilt from this repository on the current
--   Supabase image does not: that image's defaults for tables created by postgres
--   in public give the API roles only TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
--   Found on 29 September 2026 with `supabase start` (CLI 2.108, postgres
--   17.6.1.139) and all 41 migrations: the anon key got 42501 "permission denied
--   for table game_states_public", the pub TV at /display and the phone follower
--   at /player sat on "Reconnecting to the game", and even service_role could not
--   read session_reset_log.
--
--   The seven baseline tables are unaffected: 20251201000000 grants on them
--   explicitly. These two were the only tables left relying on defaults.
--
-- WHAT EACH ROLE GETS, AND WHY
--   game_states_public, the trigger-synced public mirror of game_states:
--     anon           SELECT. /display and /player are unauthenticated by design
--                    and read it over REST and Realtime. Realtime also checks
--                    SELECT before it delivers a change.
--     authenticated  SELECT. A signed-in member of staff opening /display in the
--                    same browser reads it with their own JWT.
--     service_role   ALL, the server-only posture every other table has.
--   Nothing but sync_game_states_public writes it, and that function is security
--   definer, so no API role needs INSERT, UPDATE or DELETE. RLS already refused
--   those (there is no write policy), but TRUNCATE is not governed by RLS at all.
--
--   session_reset_log, the append-only record of every session reset:
--     anon           nothing. It holds winner snapshots, and before the
--                    anonymisation some held real names. RLS gave anon zero rows,
--                    but nothing public reads it, so there is no reason to rely
--                    on RLS alone.
--     authenticated  SELECT, so the "Admins view session reset log" policy means
--                    something. RLS still limits it to admins; a host reads zero
--                    rows. No write: the only writer is reset_session_safe, which
--                    is security definer, and a record the actor can edit is not
--                    a record.
--     service_role   ALL, as above.
--
-- EFFECT ON PRODUCTION
--   A tightening only. anon and authenticated keep SELECT on the mirror and lose
--   INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, which no
--   code path uses. anon loses everything on session_reset_log, where RLS already
--   returned nothing. service_role is unchanged. No rows are touched.
--
-- GUARDED
--   It refuses if either table is missing rather than skipping it, and it checks
--   the resulting privileges role by role and raises if any differ, so a partial
--   or wrong result rolls the whole migration back instead of landing quietly.
--
-- IDEMPOTENT: yes. Revoke then grant reaches the same ACL however often it runs.
--
-- ROLLBACK (restores exactly what production held before this ran)
--   grant all on table public.game_states_public to anon, authenticated;
--   grant all on table public.session_reset_log  to anon, authenticated;

do $$
begin
  if to_regclass('public.game_states_public') is null then
    raise exception 'explicit_grants: public.game_states_public does not exist';
  end if;
  if to_regclass('public.session_reset_log') is null then
    raise exception 'explicit_grants: public.session_reset_log does not exist';
  end if;
end;
$$;

revoke all on table public.game_states_public from public, anon, authenticated;
grant select on table public.game_states_public to anon, authenticated;
grant all on table public.game_states_public to service_role;

revoke all on table public.session_reset_log from public, anon, authenticated;
grant select on table public.session_reset_log to authenticated;
grant all on table public.session_reset_log to service_role;

-- Prove the end state rather than trusting the statements above. has_table_privilege
-- answers what the role can actually do, including anything inherited via PUBLIC.
do $$
declare
  v_expected constant jsonb := jsonb_build_object(
    'game_states_public', jsonb_build_object(
      'anon',          jsonb_build_array('SELECT'),
      'authenticated', jsonb_build_array('SELECT'),
      'service_role',  jsonb_build_array('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')),
    'session_reset_log', jsonb_build_object(
      'anon',          jsonb_build_array(),
      'authenticated', jsonb_build_array('SELECT'),
      'service_role',  jsonb_build_array('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')));
  v_table text;
  v_role text;
  v_priv text;
  v_want boolean;
begin
  for v_table in select jsonb_object_keys(v_expected) loop
    for v_role in select jsonb_object_keys(v_expected -> v_table) loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        v_want := (v_expected -> v_table -> v_role) ? v_priv;
        if has_table_privilege(v_role, format('public.%I', v_table), v_priv) is distinct from v_want then
          raise exception 'explicit_grants: % on public.% should be % for %',
            v_priv, v_table, case when v_want then 'granted' else 'absent' end, v_role;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;
