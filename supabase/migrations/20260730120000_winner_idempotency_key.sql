-- Migration: give record_winner_atomic an idempotency key.
--
-- The problem this closes. 20260729120000_atomic_host_mutations.sql made the
-- winner insert and the win-display update one transaction, so a FAILED call
-- leaves nothing behind. It says plainly what that does not cover: a call that
-- commits in the database but whose response is lost on the way back to the host
-- phone. Retrying that call re-runs the whole function against the committed
-- state, and record_winner_atomic mutates none of the fields its prechecks read
-- (it only sets paused_for_validation and the display fields, which the
-- prechecks ignore). So every precheck passes a second time and a second winners
-- row lands at the same stage and the same call_count_at_win.
--
-- What the host sees: the same prize owed twice in Winners and Prizes. On a
-- snowball Full House with the jackpot window open, two rows carry
-- is_snowball_jackpot = true and each carries the cash amount in
-- prize_description. The pot itself only resets once so the money is not
-- double-deducted, but nothing on screen tells the host that the second row is
-- the same win, and the jackpot can be paid out twice.
--
-- Why not a unique constraint. Ties are real and supported: two punters can
-- shout on the same ball and both are winners. (game_id, stage) and
-- (game_id, stage, call_count_at_win) are both legitimately non-unique, so there
-- is nothing intrinsic to the win to key on.
--
-- The key is therefore supplied by the caller. The host client mints one uuid
-- when the Record Winner modal opens and sends it with the claim. One key means
-- one claim attempt, so a retry of the same tap carries the same key and is
-- refused by the index, while a genuine tie is a separate claim, a separate key,
-- and both rows save. "Validate Another Winner" mints a fresh key, which is what
-- makes the tie path work.
--
-- Behaviour on a duplicate: the function does NOT raise. It returns the current
-- game_states row, exactly as the first attempt did, so the retry is a safe
-- no-op and the host's screen still lands on Post Win. Raising would have taught
-- the host to tap again, which is the failure mode this migration exists to end.
--
-- Backwards compatible in both deploy directions:
--   * client_request_id is nullable and every existing winners row keeps null.
--     The partial index ignores nulls, so history is untouched.
--   * p_client_request_id defaults to null, so app code deployed before this
--     migration (7 named arguments) still resolves to this function and behaves
--     exactly as it did before, with no protection. The old 7-argument function
--     is dropped rather than left alongside: two overloads reachable from the
--     same 7 named arguments would make every PostgREST call ambiguous.
--
-- A null key means no protection. That is deliberate rather than an oversight:
-- it keeps the manual/rescue paths callable, and every caller in this repo
-- passes a key. See src/app/host/actions.ts (recordWinner) and
-- src/lib/claim-request-id.ts.
--
-- Conventions unchanged from 20260729120000: plpgsql, security definer,
-- set search_path = public, row lock via "for update", revoke all from public
-- then grant execute to authenticated and service_role. Still must be called
-- with the cookie-based client, never the service-role client, because
-- assert_is_host() reads auth.uid().
--
-- Error strings remain a contract with the HOST_RPC_ERRORS map in
-- src/app/host/actions.ts. This migration adds exactly one: request_id_reused.

alter table public.winners
  add column if not exists client_request_id uuid;

comment on column public.winners.client_request_id is
  'Caller-supplied idempotency key, one per claim attempt. Unique where not null, so a retried record-winner call cannot insert a second row. Null on every row written before 20260730120000 and on any call that omits it. Never used to identify a player.';

-- Partial, so the nulls on historic rows do not collide and no backfill is
-- needed. A plain unique index would also tolerate the nulls (Postgres treats
-- nulls as distinct), but the predicate states the intent and keeps the index to
-- only the rows that carry a key.
create unique index if not exists winners_client_request_id_key
  on public.winners (client_request_id)
  where client_request_id is not null;

-- Dropped, not overloaded. See the deploy note above.
drop function if exists public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean);

-- record_winner_atomic: inserts the winner row and updates the display state in
-- one transaction. Either both land or neither does, so there is never a winner
-- recorded without its announcement.
--
-- With a non-null p_client_request_id it is now also idempotent: a second call
-- carrying a key that is already on record inserts nothing and returns the
-- current state. Callers may therefore retry it safely.
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
  p_snowball_eligible boolean default false,
  p_client_request_id uuid default null
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
  v_existing_game_id uuid;
  v_constraint text;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  -- Idempotency, checked here on purpose: before the controller, status and
  -- stage prechecks rather than after them.
  --
  -- If this exact claim attempt is already on record then the write happened.
  -- Re-asserting the prechecks against it can only invent a failure: a lost
  -- response gives the game time to move on, another host may have taken
  -- control, and a retry would then be refused for a win that is already
  -- recorded. The host would read that as "it did not save" and try again. So
  -- the answer to a known key is always the same: change nothing, hand back the
  -- current state, let the client carry on to Post Win.
  --
  -- The lookup deliberately does not exclude voided rows. The key belongs to one
  -- claim attempt, so a retry after that attempt was voided is still the same
  -- attempt and still a no-op. Re-recording after a void is a new claim, which
  -- goes through Validate Another Winner and mints a new key.
  if p_client_request_id is not null then
    select game_id into v_existing_game_id
      from public.winners
     where client_request_id = p_client_request_id;

    if v_existing_game_id is not null then
      if v_existing_game_id <> p_game_id then
        -- One key means one claim. A key already spent on a different game is a
        -- client bug, not a retry, and answering "fine, already done" would
        -- silently swallow a real win.
        raise exception 'request_id_reused';
      end if;

      return v_state;
    end if;
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
  --
  -- The insert sits in its own block so a duplicate key is answered rather than
  -- raised. The lookup above is the fast path and catches every ordinary retry;
  -- two attempts of the same claim serialise on the game_states row lock, so the
  -- loser reads the winner's committed row and returns at the lookup. This
  -- handler is the backstop for anything that gets past that, and the index is
  -- what actually guarantees one row per key.
  begin
    insert into public.winners (
      session_id,
      game_id,
      stage,
      winner_name,
      prize_description,
      call_count_at_win,
      is_snowball_eligible,
      is_snowball_jackpot,
      prize_given,
      client_request_id
    ) values (
      p_session_id,
      p_game_id,
      p_stage,
      'Anonymous',
      v_prize,
      v_call_count,
      coalesce(p_snowball_eligible, false),
      v_is_jackpot,
      coalesce(p_prize_given, false),
      p_client_request_id
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      -- Only our key is idempotent. Any other unique violation is a real fault
      -- and must keep raising, otherwise a genuine failure returns success.
      if v_constraint is distinct from 'winners_client_request_id_key' then
        raise;
      end if;

      -- Re-read outside the rolled-back sub-transaction so the caller gets the
      -- state the winning attempt left, not the snapshot from before it.
      select * into v_state
        from public.game_states
       where game_id = p_game_id;

      return v_state;
  end;

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

revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from public;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) to authenticated;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) to service_role;
