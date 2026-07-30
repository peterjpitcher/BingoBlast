-- Migration: atomic versions of the host hot-path mutations.
--
-- Why this exists. The host actions for "call next number", "undo last number"
-- and "record winner" were read-then-write sequences spread over several
-- round trips. That left three defects:
--   1. The prechecks (controller, status, on_break, paused_for_validation) were
--      not binding at write time, so a concurrent break or claim pause could
--      slip in between the check and the write.
--   2. The undo winner guard counted winners in a separate statement from the
--      decrement, so a winner inserted in between survived against a
--      rolled-back call count. It also failed to filter voided winners, which
--      made the guard a dead end for the host.
--   3. record_winner inserted the winner and then updated the display state as
--      two statements. A failure on the second left a winner recorded with no
--      announcement on screen.
--
-- These functions do the check and the mutation under a single row lock inside
-- one transaction, so the precheck is binding for the lifetime of the mutation
-- and a FAILED call leaves nothing behind.
--
-- What that does NOT cover: a call that commits in the database but whose
-- response is lost on the way back to the caller. Retrying it runs the whole
-- function again against the committed state. call_next_number and
-- void_last_number move the count they check, so the repeat is rejected or is at
-- least visible. record_winner_atomic mutates none of the fields it checks, so
-- every precheck passes a second time and a second winner row is inserted.
-- Legitimate ties mean there is no unique constraint to lean on. An idempotency
-- key for record_winner_atomic is tracked separately; until it lands, callers
-- must not auto-retry that function.
--
-- Conventions follow 20260430120300_atomic_admin_mutations.sql: plpgsql,
-- security definer, set search_path = public, row lock via "for update",
-- revoke all from public then grant execute to authenticated and service_role.
-- The service_role grant matches the hardened privilege set every other RPC in
-- this schema carries in production.
--
-- Each function also revokes EXECUTE from anon explicitly. This is NOT redundant
-- with the revoke from PUBLIC: ALTER DEFAULT PRIVILEGES on this project grants
-- EXECUTE on every new public-schema function to the named role anon, and
-- revoking from PUBLIC does not touch a grant held by a named role. Without the
-- anon line these functions are created anon-callable. Dropping it silently
-- re-opens that. 20260730070705_revoke_anon_execute_on_host_rpcs.sql is the same
-- revoke applied to the production database, which was built from this file
-- before these lines existed; the lines here are what stop a FRESH database ever
-- passing through that state in the first place.
--
-- IMPORTANT for callers: every function here goes through assert_is_host(),
-- which reads auth.uid(). They must be invoked with the cookie-based Supabase
-- client (the authenticated role), never the service-role client, because
-- auth.uid() is null under service_role and the call would be rejected. The
-- security definer marking is what removes the need for a service-role client:
-- the privileged insert and updates run as the function owner.
--
-- Error messages are deliberately short and machine readable. The TypeScript
-- layer in src/app/host/actions.ts maps each one to host-facing text, so these
-- strings are a contract. Do not reword them without updating that map.
-- The full set raised here: not_controller, not_in_progress, on_break,
-- paused_for_validation, too_soon:<remaining_ms>, no_more_numbers,
-- nothing_to_void, winner_on_ball, stage_mismatch, wrong_session,
-- game_not_found, game_state_not_found, and 'unauthorized: ...' from
-- assert_is_host.
--
-- Notes on the data model, verified against production:
--   * game_states.number_sequence and game_states.called_numbers are jsonb,
--     NOT integer arrays. Read with -> (0-indexed), measure with
--     jsonb_array_length(), append with || to_jsonb(x), delete an element with
--     "jsonb - integer".
--   * numbers_called_count, called_numbers, status, on_break and
--     paused_for_validation are all nullable with defaults, so they are
--     coalesced before use.
--   * state_version is maintained by the bump_game_state_version BEFORE UPDATE
--     trigger and the public mirror by the on_game_states_upsert AFTER trigger.
--     Nothing here sets state_version itself.

-- Helper: assert the current authenticated user is a host or an admin.
-- Mirrors authorizeHost() in src/app/host/actions.ts.
create or replace function public.assert_is_host()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'host')
  ) then
    raise exception 'unauthorized: host or admin role required';
  end if;
end;
$$;

revoke all on function public.assert_is_host() from public;
revoke execute on function public.assert_is_host() from anon;
grant execute on function public.assert_is_host() to authenticated;
grant execute on function public.assert_is_host() to service_role;

-- call_next_number: draws the next ball from number_sequence and appends it to
-- called_numbers under a row lock.
--
-- p_min_gap_ms is the host anti-double-tap window in milliseconds, supplied by
-- the caller as HOST_MIN_CALL_GAP_MS from src/lib/call-timing.ts. It is NOT the
-- public reveal delay: that is game_states.call_delay_seconds, which only the
-- public surfaces read. The two were conflated before this change.
create or replace function public.call_next_number(
  p_game_id uuid,
  p_min_gap_ms int default 400
) returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.game_states;
  v_count int;
  v_next int;
  v_remaining_ms numeric;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress';
  end if;

  if coalesce(v_state.on_break, false) then
    raise exception 'on_break';
  end if;

  if coalesce(v_state.paused_for_validation, false) then
    raise exception 'paused_for_validation';
  end if;

  v_count := coalesce(v_state.numbers_called_count, 0);

  -- numbers_called_count doubles as the 0-indexed cursor into number_sequence,
  -- so the count reaching the sequence length means the bag is empty.
  if v_state.number_sequence is null
     or jsonb_typeof(v_state.number_sequence) <> 'array'
     or v_count >= jsonb_array_length(v_state.number_sequence) then
    raise exception 'no_more_numbers';
  end if;

  -- Server-side gap enforcement. Kept server-side deliberately: with the row
  -- lock above it is the only thing preventing a double call under contention.
  -- The remaining milliseconds are appended after a colon so the TypeScript
  -- layer can tell the host how long to wait.
  if v_state.last_call_at is not null and v_count > 0 then
    v_remaining_ms := coalesce(p_min_gap_ms, 0)
      - (extract(epoch from (now() - v_state.last_call_at)) * 1000);
    if v_remaining_ms > 0 then
      raise exception 'too_soon:%', ceil(v_remaining_ms)::bigint;
    end if;
  end if;

  v_next := (v_state.number_sequence -> v_count)::int;

  update public.game_states
     set called_numbers = coalesce(called_numbers, '[]'::jsonb) || to_jsonb(v_next),
         numbers_called_count = coalesce(numbers_called_count, 0) + 1,
         last_call_at = now()
   where game_id = p_game_id
   returning * into v_state;

  return v_state;
end;
$$;

revoke all on function public.call_next_number(uuid, int) from public;
revoke execute on function public.call_next_number(uuid, int) from anon;
grant execute on function public.call_next_number(uuid, int) to authenticated;
grant execute on function public.call_next_number(uuid, int) to service_role;

-- void_last_number: takes the most recently called ball back off the board.
--
-- The ball goes back in the bag. number_sequence is untouched while
-- numbers_called_count decrements, so the next call re-draws the same number.
-- This is intended behaviour (decision D2), and the host confirm modal says so.
--
-- last_call_at is deliberately NOT touched. Preserving the original comment
-- from src/app/host/actions.ts: the timestamp belongs to the call that was
-- made, not to the undo. The public surfaces gate a reveal on
-- last_call_at + call_delay_seconds, so leaving it alone means a void before
-- the ball was revealed drops it silently, and a void after reveal snaps the
-- screens back. Resetting it here would restart the reveal clock for a ball
-- that no longer exists.
create or replace function public.void_last_number(p_game_id uuid)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.game_states;
  v_count int;
  v_length int;
  v_winners int;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress';
  end if;

  v_count := coalesce(v_state.numbers_called_count, 0);

  if v_state.called_numbers is null
     or jsonb_typeof(v_state.called_numbers) <> 'array' then
    v_length := 0;
  else
    v_length := jsonb_array_length(v_state.called_numbers);
  end if;

  if v_count = 0 or v_length = 0 then
    raise exception 'nothing_to_void';
  end if;

  -- Blocking winners are counted inside this transaction, under the same row
  -- lock as the decrement, so a winner inserted concurrently cannot survive
  -- against a rolled-back call count. Voided winners do not block: the host
  -- clears a blocked undo by voiding the winner with a reason, then undoing.
  select count(*) into v_winners
    from public.winners
   where game_id = p_game_id
     and call_count_at_win = v_count
     and coalesce(is_void, false) = false;

  if v_winners > 0 then
    raise exception 'winner_on_ball';
  end if;

  -- Remove the last element of called_numbers. Under the invariant maintained
  -- by call_next_number this index equals numbers_called_count - 1; addressing
  -- it by array length means a legacy row where the two disagree still has the
  -- correct ball removed rather than an arbitrary one.
  update public.game_states
     set called_numbers = coalesce(called_numbers, '[]'::jsonb) - (v_length - 1),
         numbers_called_count = coalesce(numbers_called_count, 0) - 1,
         display_win_type = null,
         display_win_text = null,
         display_winner_name = null
   where game_id = p_game_id
   returning * into v_state;

  return v_state;
end;
$$;

revoke all on function public.void_last_number(uuid) from public;
revoke execute on function public.void_last_number(uuid) from anon;
grant execute on function public.void_last_number(uuid) to authenticated;
grant execute on function public.void_last_number(uuid) to service_role;

-- record_winner_atomic: inserts the winner row and updates the display state in
-- one transaction. Either both land or neither does, so there is never a winner
-- recorded without its announcement.
--
-- It is NOT idempotent. Retrying a call that already committed inserts a second
-- winner: the function mutates none of the fields its prechecks read, and
-- legitimate ties rule out a unique constraint on (game_id, stage). Callers must
-- not auto-retry. An idempotency key is tracked separately.
--
-- Snowball eligibility is recomputed here from the locked pot row. The client's
-- p_snowball_eligible is the host's explicit Eligible / Not eligible choice, and
-- it can only award the jackpot while the call window is genuinely open. A test
-- session (sessions.is_test_session) suppresses the jackpot entirely so a
-- rehearsal cannot touch the real pot.
--
-- The prize text and the display win type and text reproduce the rules
-- previously held in src/app/host/actions.ts, including formatPounds():
-- trim_scale(round(amount, 2)) gives the same output as the TypeScript helper
-- for every realistic money value.
create or replace function public.record_winner_atomic(
  p_session_id uuid,
  p_game_id uuid,
  p_stage public.win_stage,
  p_prize_description text default null,
  p_prize_given boolean default false,
  p_force_snowball_jackpot boolean default false,
  p_snowball_eligible boolean default false
) returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.game_states;
  v_game public.games;
  v_is_test boolean;
  v_call_count int;
  v_expected_stage text;
  v_pot_max_calls int;
  v_pot_amount numeric;
  v_is_snowball_full_house boolean := false;
  v_window_open boolean := false;
  v_is_jackpot boolean := false;
  v_jackpot_amount numeric;
  v_amount_text text;
  v_jackpot_text text;
  v_prize text;
  v_display_win_type text;
  v_display_win_text text;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress';
  end if;

  select * into v_game from public.games where id = p_game_id;

  if v_game.id is null then
    raise exception 'game_not_found';
  end if;

  if v_game.session_id <> p_session_id then
    raise exception 'wrong_session';
  end if;

  -- The claimed stage must be the live stage. stage_sequence is jsonb, so ->>
  -- with the 0-indexed current_stage_index gives the stage name as text.
  v_expected_stage := v_game.stage_sequence ->> coalesce(v_state.current_stage_index, 0);

  if v_expected_stage is null or v_expected_stage <> p_stage::text then
    raise exception 'stage_mismatch';
  end if;

  -- Always taken from the locked row, never from the client.
  v_call_count := coalesce(v_state.numbers_called_count, 0);

  select coalesce(is_test_session, false) into v_is_test
    from public.sessions
   where id = p_session_id;
  v_is_test := coalesce(v_is_test, false);

  if v_is_test = false
     and v_game.type = 'snowball'::public.game_type
     and p_stage = 'Full House'::public.win_stage
     and v_game.snowball_pot_id is not null then
    v_is_snowball_full_house := true;

    select current_max_calls, current_jackpot_amount
      into v_pot_max_calls, v_pot_amount
      from public.snowball_pots
     where id = v_game.snowball_pot_id
     for update;

    -- current_max_calls is NOT NULL on the table, so a null here means the pot
    -- row is missing. Matches the TypeScript "if (snowballPot)" guard.
    if v_pot_max_calls is not null then
      v_window_open := v_call_count <= v_pot_max_calls;

      if coalesce(p_force_snowball_jackpot, false)
         or (v_window_open and coalesce(p_snowball_eligible, false)) then
        v_is_jackpot := true;
        v_jackpot_amount := v_pot_amount;
      end if;
    end if;
  end if;

  v_prize := nullif(btrim(coalesce(p_prize_description, '')), '');

  if v_is_jackpot and v_jackpot_amount is not null then
    v_amount_text := trim_scale(round(v_jackpot_amount, 2))::text;
    v_jackpot_text := 'Snowball Jackpot £' || v_amount_text;

    if v_prize is null then
      v_prize := v_jackpot_text;
    elsif position('snowball' in lower(v_prize)) = 0 then
      v_prize := v_prize || ' + ' || v_jackpot_text;
    end if;
  end if;

  -- Display win type and text. Snowball jackpot wins keep their celebratory
  -- text including the cash amount; hiding the jackpot amount would be worse
  -- for the room. Every other win uses the generic 'BINGO!' label.
  if v_is_jackpot then
    v_display_win_type := 'snowball';
    if v_jackpot_amount is not null then
      v_display_win_text := 'FULL HOUSE + SNOWBALL £' || v_amount_text || '!';
    else
      v_display_win_text := 'FULL HOUSE + SNOWBALL JACKPOT!';
    end if;
  elsif v_is_snowball_full_house
        and v_window_open
        and not coalesce(p_snowball_eligible, false) then
    -- Snowball game, window still open, but the host marked the claim as
    -- ineligible for the jackpot prize.
    v_display_win_type := 'full_house';
    v_display_win_text := 'BINGO!';
  elsif v_is_snowball_full_house and not v_window_open then
    v_display_win_type := 'full_house';
    v_display_win_text := 'BINGO!';
  else
    case p_stage
      when 'Line'::public.win_stage then v_display_win_type := 'line';
      when 'Two Lines'::public.win_stage then v_display_win_type := 'two_lines';
      when 'Full House'::public.win_stage then v_display_win_type := 'full_house';
      else v_display_win_type := 'win';
    end case;
    v_display_win_text := 'BINGO!';
  end if;

  -- winner_name is always 'Anonymous' by policy. The app stores no
  -- player-identifying information and there is no UI to supply a name.
  insert into public.winners (
    session_id,
    game_id,
    stage,
    winner_name,
    prize_description,
    call_count_at_win,
    is_snowball_eligible,
    is_snowball_jackpot,
    prize_given
  ) values (
    p_session_id,
    p_game_id,
    p_stage,
    'Anonymous',
    v_prize,
    v_call_count,
    coalesce(p_snowball_eligible, false),
    v_is_jackpot,
    coalesce(p_prize_given, false)
  );

  -- display_winner_name stays null so the public surfaces show only the
  -- celebratory text.
  update public.game_states
     set paused_for_validation = true,
         display_win_type = v_display_win_type,
         display_win_text = v_display_win_text,
         display_winner_name = null
   where game_id = p_game_id
   returning * into v_state;

  return v_state;
end;
$$;

revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean) from public;
revoke execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean) from anon;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean) to service_role;
