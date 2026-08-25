-- Reconstructs the six snowball pot movements that happened before the audit
-- table existed, clearly marked as reconstructed.
--
-- WHY
--   The pot currently advertises £140 to the room and snowball_pot_history is
--   empty, so there is no answer anywhere to "how did it get there?". The audit
--   table was added on 29 July 2026, about five hours after the last session
--   finished, so every movement to date happened before anything was recording
--   them. Decision taken by the owner on 2026-08-25: put them back, marked as
--   reconstructed, because otherwise the figure on the TV can never be
--   reconciled from stored data.
--
-- THE ARITHMETIC, AND WHY IT IS NOT A GUESS
--   Read from production on 2026-08-25:
--     base_max_calls 42, calls_increment 2, current_max_calls 54
--       => 42 + 6 x 2 = 54, so six increments
--     base_jackpot_amount 20, jackpot_increment 20, current_jackpot_amount 140
--       => 20 + 6 x 20 = 140, so six increments, agreeing exactly
--     last_awarded_at is null, so the jackpot has never been won and every one
--       of the six was a rollover, not a reset
--     six completed sessions, each containing exactly one snowball game, all
--       "Game 9 - Pink (SNOWBALL)", index 9
--
--   Six increments, six sessions, one snowball game each, no wins. The mapping
--   is forced rather than chosen, which is the only reason this is safe to write
--   at all.
--
-- WHAT THIS DOES AND DOES NOT CLAIM
--   change_type is 'reconstructed_rollover', not 'rollover'. These rows are
--   derived from the pot's own arithmetic, not observed at the time, and the
--   screen renders them as such. changed_by is null because nobody recorded who
--   ran those nights. created_at is set to the session's snowball game end where
--   it is known, so the history reads in the right order rather than all six
--   landing at the moment this migration runs.
--
-- A CONSEQUENCE WORTH STATING
--   These rows carry game_id, which claims the settlement for those six games
--   under the partial unique index on (snowball_pot_id, game_id). That is
--   correct, and it has two deliberate effects: settle_snowball_pot will report
--   'already_settled' for them rather than moving the pot a seventh time, and
--   reset_session_safe will now refuse to reset those six sessions. Both are the
--   right answer. Those nights did settle the pot, and rewinding them is exactly
--   what the reset guard exists to prevent.
--
-- DRY RUN AGAINST PRODUCTION, read-only, 2026-08-25. These are the exact six
-- rows this migration will write, and they land precisely on the pot's current
-- figures of 54 calls / £140:
--
--   February 18th 2026, 21:01   42 -> 44 calls    £20  -> £40
--   March 18th 2026,    21:08   44 -> 46 calls    £40  -> £60
--   April 29th 2026,    20:09   46 -> 48 calls    £60  -> £80
--   May 20th 2026,      20:07   48 -> 50 calls    £80  -> £100
--   July 1st 2026,      20:09   50 -> 52 calls    £100 -> £120
--   July 29th 2026,     20:17   52 -> 54 calls    £120 -> £140
--
-- IDEMPOTENT
--   The insert is guarded by the same unique index, so a second run inserts
--   nothing. It also does nothing at all on a database that has no pot, which is
--   every environment except production and the test harness.
--
-- ROLLBACK
--   delete from public.snowball_pot_history where change_type = 'reconstructed_rollover';

do $$
declare
  v_pot public.snowball_pots;
  v_game record;
  v_expected_increments int;
  v_actual_sessions int;
  v_running_max int;
  v_running_jackpot numeric;
begin
  -- Exactly one pot exists in production. If a future database has none, or
  -- more than one, this is not the migration that should be guessing.
  select * into v_pot from public.snowball_pots order by created_at limit 1;
  if v_pot.id is null then
    raise notice 'no snowball pot, nothing to reconstruct';
    return;
  end if;

  if (select count(*) from public.snowball_pots) <> 1 then
    raise notice 'more than one snowball pot: skipping reconstruction rather than guessing which one moved';
    return;
  end if;

  -- Only reconstruct when the pot has never been won. A reset in the history
  -- would break the "every movement was a rollover" assumption the arithmetic
  -- below depends on.
  if v_pot.last_awarded_at is not null then
    raise notice 'pot has been awarded at some point: not reconstructible from increments alone';
    return;
  end if;

  if coalesce(v_pot.calls_increment, 0) = 0 then
    raise notice 'calls_increment is zero: cannot derive the number of rollovers';
    return;
  end if;

  v_expected_increments := (v_pot.current_max_calls - v_pot.base_max_calls) / v_pot.calls_increment;

  -- The two independent derivations must agree, or the pot has been adjusted by
  -- hand at some point and the increments no longer explain it.
  if v_pot.base_max_calls + (v_expected_increments * v_pot.calls_increment) <> v_pot.current_max_calls
     or v_pot.base_jackpot_amount + (v_expected_increments * v_pot.jackpot_increment) <> v_pot.current_jackpot_amount then
    raise notice 'calls and jackpot do not agree on the number of rollovers: not reconstructing';
    return;
  end if;

  if v_expected_increments <= 0 then
    raise notice 'pot is still at base, nothing to reconstruct';
    return;
  end if;

  select count(*) into v_actual_sessions
    from public.games g
    join public.game_states gs on gs.game_id = g.id
   where g.snowball_pot_id = v_pot.id
     and g.type = 'snowball'::public.game_type
     and gs.status = 'completed'::public.game_status;

  if v_actual_sessions <> v_expected_increments then
    raise notice 'pot moved % times but % completed snowball games exist: not reconstructing',
      v_expected_increments, v_actual_sessions;
    return;
  end if;

  -- Walk the games in the order they were played, carrying the pot forward, so
  -- each row's old and new values are the ones that were true at the time.
  v_running_max := v_pot.base_max_calls;
  v_running_jackpot := v_pot.base_jackpot_amount;

  for v_game in
    select g.id, gs.ended_at, s.start_date
      from public.games g
      join public.game_states gs on gs.game_id = g.id
      join public.sessions s on s.id = g.session_id
     where g.snowball_pot_id = v_pot.id
       and g.type = 'snowball'::public.game_type
       and gs.status = 'completed'::public.game_status
     order by s.start_date, gs.ended_at
  loop
    insert into public.snowball_pot_history (
      snowball_pot_id, game_id, change_type,
      old_val_max, new_val_max,
      old_val_jackpot, new_val_jackpot,
      changed_by, created_at
    ) values (
      v_pot.id,
      v_game.id,
      'reconstructed_rollover',
      v_running_max,
      v_running_max + v_pot.calls_increment,
      v_running_jackpot,
      v_running_jackpot + v_pot.jackpot_increment,
      null,
      coalesce(v_game.ended_at, v_game.start_date::timestamptz, now())
    )
    on conflict do nothing;

    v_running_max := v_running_max + v_pot.calls_increment;
    v_running_jackpot := v_running_jackpot + v_pot.jackpot_increment;
  end loop;

  -- The reconstruction has to land exactly on the pot's current figures, or it
  -- is telling a story that does not end where the pot actually is.
  if v_running_max <> v_pot.current_max_calls
     or v_running_jackpot <> v_pot.current_jackpot_amount then
    raise exception 'reconstruction ended at %/% but the pot is at %/%',
      v_running_max, v_running_jackpot, v_pot.current_max_calls, v_pot.current_jackpot_amount;
  end if;

  raise notice 'reconstructed % pot movements ending at % calls / %',
    v_expected_increments, v_running_max, v_running_jackpot;
end
$$;
