-- The forced snowball jackpot stops bypassing the call window, and stops paying
-- a second jackpot on a pot that pays once.
--
-- WHY: THE FORCE FLAG SKIPPED THE ONLY CHECK THAT MATTERS
--   record_winner_atomic decides the jackpot with:
--
--     if coalesce(p_force_snowball_jackpot, false)
--        or (v_window_open and coalesce(p_snowball_eligible, false)) then
--
--   The force branch is not gated by v_window_open at all. CLAUDE.md states
--   that "the window is re-checked inside record_winner_atomic, so an
--   out-of-window jackpot cannot be awarded by the client", which is simply not
--   true on that path. Anyone holding a host JWT can POST to
--   /rest/v1/rpc/record_winner_atomic with p_force_snowball_jackpot true at any
--   call count and be paid the full pot, and the host UI offers the same thing
--   as a button ("Manual Snowball Win") that is enabled for any host at any call
--   count, on any stage, including after the window has closed.
--
-- WHY: A TIE PAID THE JACKPOT TWICE ON PAPER
--   Two tied Full House winners each recorded is_snowball_jackpot true with the
--   full pot in prize_description, while settle_snowball_pot resets the pot once
--   because it only asks whether a jackpot winner exists. So the record claimed
--   two full jackpots were paid out of a pot that paid one. How the cash is
--   actually split between tied winners is a business rule that has not been
--   decided (see the decision log), and this migration does NOT decide it. It
--   fixes only the half that is wrong under every possible answer: the pot pays
--   one jackpot, so at most one winner per game carries the jackpot flag.
--
-- WHAT THE FORCE FLAG NOW MEANS
--   It no longer means "skip the window". It means "the host is asserting the
--   claim qualifies", and it still has to be inside the window. The genuine use
--   is a claim made at the right moment that the host is recording slightly
--   after it, not an award made once the window has closed. If a genuinely
--   out-of-window jackpot ever has to be paid, that is an admin correction on
--   /admin/snowball, which is audited, rather than a button on a live game
--   screen.
--
-- ROLLBACK
--   Reinstate the previous body from
--   20260730064309_winner_idempotency_key.sql. Nothing else changes.

create or replace function public.record_winner_atomic(
  p_session_id uuid,
  p_game_id uuid,
  p_stage public.win_stage,
  p_prize_description text default null,
  p_prize_given boolean default false,
  p_force_snowball_jackpot boolean default false,
  p_snowball_eligible boolean default false,
  p_client_request_id uuid default null
)
returns public.game_states
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_jackpot_already_awarded boolean := false;
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

  -- Idempotency, checked before the controller, status and stage prechecks on
  -- purpose. If this exact claim attempt is already on record then the write
  -- happened, and re-asserting the prechecks can only invent a failure for a win
  -- that already saved. The lookup deliberately does not exclude voided rows.
  if p_client_request_id is not null then
    select game_id into v_existing_game_id
      from public.winners
     where client_request_id = p_client_request_id;

    if v_existing_game_id is not null then
      if v_existing_game_id <> p_game_id then
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

  v_expected_stage := v_game.stage_sequence ->> coalesce(v_state.current_stage_index, 0);

  if v_expected_stage is null or v_expected_stage <> p_stage::text then
    raise exception 'stage_mismatch';
  end if;

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

    -- Has this game already paid its jackpot? The pot resets once, so it can
    -- only be won once. A tie is still two winners, both still valid, but the
    -- second one does not carry the jackpot flag or the jackpot amount.
    select exists (
      select 1 from public.winners
       where game_id = p_game_id
         and coalesce(is_snowball_jackpot, false)
         and coalesce(is_void, false) = false
    ) into v_jackpot_already_awarded;

    if v_pot_max_calls is not null and not v_jackpot_already_awarded then
      v_window_open := v_call_count <= v_pot_max_calls;

      -- The window is now binding on BOTH routes. p_force_snowball_jackpot used
      -- to skip it entirely, which made the documented guarantee false and let
      -- any host award the full pot at any call count.
      if v_window_open
         and (coalesce(p_force_snowball_jackpot, false) or coalesce(p_snowball_eligible, false)) then
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

  -- The insert sits in its own block so a duplicate key is answered rather than
  -- raised. The lookup above is the fast path; the index is what guarantees one
  -- row per key, and this handler is the backstop under contention.
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
      -- and must keep raising.
      if v_constraint is distinct from 'winners_client_request_id_key' then
        raise;
      end if;

      select * into v_state
        from public.game_states
       where game_id = p_game_id;

      return v_state;
  end;

  update public.game_states
     set paused_for_validation = true,
         display_win_type = v_display_win_type,
         display_win_text = v_display_win_text,
         display_winner_name = null
   where game_id = p_game_id
  returning * into v_state;

  return v_state;
end;
$function$;

-- Recreating the function rebuilds its ACL from the schema default privileges,
-- which grant EXECUTE to anon. Both revokes, as always. This is exactly how the
-- eight-argument version picked the grant back up when winner_idempotency_key
-- replaced the seven-argument one.
revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from public;
revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from anon;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) to authenticated, service_role;

comment on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) is
  'Records a winner atomically with the win announcement. Idempotent on client_request_id. The snowball jackpot requires the call window to be open on BOTH the eligible and the forced route, and is awarded at most once per game because the pot resets once.';
