-- Rollback for 20261001000100_night_lifecycle.sql (M1). Function definitions
-- only.
--
-- WHAT IT DOES
--   Drops start_game, finish_game and end_night, drops the sessions stamp
--   trigger and its function, and restores reset_session_safe to the body it
--   had before M1 (from 20260825080604), verbatim as pg_get_functiondef printed
--   it from a replay of every migration up to 20260929103018.
--
-- WHAT IT DOES NOT DO
--   It reverses no data. sessions.started_at, completed_at and state_version
--   stay, with whatever values they hold; nothing in the pre-M1 app reads them.
--   A night that was ended, reset or re-opened stays as it is.
--
-- ORDER
--   Roll back M2b, M3 and M2a first. The host app must be on the pre-M1 build,
--   which writes game_states and sessions directly and never calls the three
--   functions dropped here.
--
-- Tested by suite F in supabase/tests/run.sh, which applies M1 to M2b, rolls
-- all four back, and asserts every function definition, ACL and trigger is
-- exactly what it was before M1.

drop function if exists public.start_game(uuid, integer[]);
drop function if exists public.finish_game(uuid);
drop function if exists public.end_night(uuid);

drop trigger if exists sessions_lifecycle_stamp on public.sessions;
drop function if exists public.sessions_lifecycle_stamp();

CREATE OR REPLACE FUNCTION public.reset_session_safe(p_session_id uuid)
 RETURNS public.session_reset_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.sessions;
  v_settled_pot_name text;
  v_winners jsonb;
  v_winner_count int;
  v_state_count int;
  v_log public.session_reset_log;
begin
  perform public.assert_is_admin();

  select * into v_session
    from public.sessions
   where id = p_session_id
   for update;

  if v_session.id is null then
    raise exception 'session_not_found';
  end if;

  -- Refuse if any game in this session has already settled the pot. Resetting
  -- would leave the claim in place and the pot where this night put it, and the
  -- replayed night could then never move the pot again.
  select p.name into v_settled_pot_name
    from public.snowball_pot_history h
    join public.games g on g.id = h.game_id
    join public.snowball_pots p on p.id = h.snowball_pot_id
   where g.session_id = p_session_id
   limit 1;

  if v_settled_pot_name is not null then
    raise exception 'snowball_already_settled:%', v_settled_pot_name;
  end if;

  -- Snapshot before deleting. jsonb_agg over zero rows is null, which is the
  -- right answer for "this session had no winners".
  select jsonb_agg(to_jsonb(w) order by w.created_at), count(*)
    into v_winners, v_winner_count
    from public.winners w
   where w.session_id = p_session_id;

  select count(*) into v_state_count
    from public.game_states gs
    join public.games g on g.id = gs.game_id
   where g.session_id = p_session_id;

  insert into public.session_reset_log (
    session_id, session_name, reset_by,
    winners_deleted, game_states_deleted, winners_snapshot
  ) values (
    p_session_id, v_session.name, auth.uid(),
    coalesce(v_winner_count, 0), coalesce(v_state_count, 0), v_winners
  )
  returning * into v_log;

  delete from public.winners where session_id = p_session_id;

  delete from public.game_states gs
   using public.games g
   where gs.game_id = g.id and g.session_id = p_session_id;

  update public.sessions
     set status = 'ready', active_game_id = null
   where id = p_session_id;

  return v_log;
end;
$function$

;

revoke all on function public.reset_session_safe(uuid) from public;
revoke all on function public.reset_session_safe(uuid) from anon;
grant execute on function public.reset_session_safe(uuid) to authenticated, service_role;

comment on function public.reset_session_safe(uuid) is
  'Wipes a session back to ready. Admin only. Records everything it destroys in session_reset_log first, and refuses outright when the session has already settled a snowball pot, because the pot cannot be safely rewound.';
