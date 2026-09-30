-- M2b: a winner is recorded only from a checked claim. Applied LAST, after
-- M3, once every host screen runs the claim flow (spec section 12).
--
-- WHY
--   Until now record_winner_atomic trusted the host's phone: whatever the
--   phone had decided was a win became a winner, and the manual snowball flag
--   skipped the claim entirely on any game. With M2a the server holds the
--   claimed numbers and gives the verdict, so the record can require it.
--
-- WHAT CHANGES in record_winner_atomic (written on the M3 body,
-- 20261001000300_jackpot_components.sql; nothing else in it changes: the tie
-- split, prize_share_pence and the jackpot components, the snowball window and
-- eligibility, anonymity, the grants)
--   1. The idempotency lookup stays FIRST, so a committed save retried after a
--      reload, the next stage or a takeover returns the existing winner.
--   2. A new winner needs the valid attempt: paused, claim_attempt_id equal to
--      p_client_request_id, claim_stage_index equal to the current stage, and
--      claim_result 'valid'. The stored claim_numbers are then re-checked
--      under the lock: the stage's count, every number called, and the last
--      ball among them.
--   3. The only exemption is Manual Snowball Win: p_force_snowball_jackpot AND
--      a snowball game with a pot AND the Full House stage AND the jackpot
--      window open, all under the lock, and not a test session (a test session
--      never computes the window). The flag alone no longer skips anything.
--   4. Stage-specific win text: LINE WINNER!, TWO LINES WINNER!, FULL HOUSE
--      WINNER!, or the snowball text as before.
--   5. Money text to two decimal places when there are pence, with thousands
--      separators, and no ".00" when there are none, matching the app's
--      formatting: 212.5 is "£212.50", 1250 is "£1,250", 140 is "£140". The
--      pattern uses literal "," and "." rather than G and D, so the text does
--      not depend on the server's lc_numeric.
--
-- ERROR KEYS added (errcode P0001), on a new winner only:
--   claim_not_checked   not paused for a claim, or the attempt has no verdict
--   attempt_mismatch    p_client_request_id is null or not the attempt on the row
--   stale_attempt       the stage moved since the check started
--   claim_not_valid     the verdict is invalid or late, or the stored numbers no
--                       longer pass the re-check
--   Every key it raised before is unchanged.
--
-- IDEMPOTENT: yes, one create or replace.
--
-- ROLLBACK: supabase/rollback/20261001000400_claim_enforcement.rollback.sql
-- restores the M3 definition.

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
set search_path = public, pg_catalog
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
  v_manual_exempt boolean := false;
  v_jackpot_amount numeric;
  v_amount_text text;
  v_jackpot_text text;
  v_prize text;
  v_display_win_type text;
  v_display_win_text text;
  v_existing_game_id uuid;
  v_constraint text;
  v_called integer[];
  v_claim integer[];
  v_last integer;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  -- 1. Idempotency first: a claim already on record is returned as it stands,
  -- whatever has happened to the game since.
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

    if v_pot_max_calls is not null then
      v_window_open := v_call_count <= v_pot_max_calls;

      -- The window is binding on BOTH routes, and tied jackpot winners share
      -- the pot, as in 20260825080608.
      if v_window_open
         and (coalesce(p_force_snowball_jackpot, false) or coalesce(p_snowball_eligible, false)) then
        v_is_jackpot := true;
        v_jackpot_amount := v_pot_amount;
      end if;
    end if;
  end if;

  -- 3. The manual exemption, and only it, skips the claim.
  v_manual_exempt := coalesce(p_force_snowball_jackpot, false)
                     and v_is_snowball_full_house
                     and v_window_open;

  -- 2. Otherwise a new winner needs the checked, valid attempt.
  if not v_manual_exempt then
    if not coalesce(v_state.paused_for_validation, false) then
      raise exception 'claim_not_checked' using errcode = 'P0001';
    end if;

    if p_client_request_id is null
       or v_state.claim_attempt_id is distinct from p_client_request_id then
      raise exception 'attempt_mismatch' using errcode = 'P0001';
    end if;

    if v_state.claim_stage_index is distinct from v_state.current_stage_index then
      raise exception 'stale_attempt' using errcode = 'P0001';
    end if;

    if v_state.claim_result is null then
      raise exception 'claim_not_checked' using errcode = 'P0001';
    end if;

    if v_state.claim_result <> 'valid' then
      raise exception 'claim_not_valid' using errcode = 'P0001';
    end if;

    -- The re-check, under the lock, against the board as it is now.
    select coalesce(array_agg(e.value::integer order by e.ordinality), '{}'::integer[])
      into v_called
      from jsonb_array_elements_text(
             case when jsonb_typeof(v_state.called_numbers) = 'array'
                  then v_state.called_numbers else '[]'::jsonb end
           ) with ordinality as e(value, ordinality);

    select coalesce(array_agg(e.value::integer order by e.ordinality), '{}'::integer[])
      into v_claim
      from jsonb_array_elements_text(
             case when jsonb_typeof(v_state.claim_numbers) = 'array'
                  then v_state.claim_numbers else '[]'::jsonb end
           ) with ordinality as e(value, ordinality);

    v_last := case when v_call_count > 0 then v_called[v_call_count] end;

    if cardinality(v_claim) is distinct from public.required_claim_count(v_expected_stage)
       or exists (select 1 from unnest(v_claim) n where not (n = any (v_called)))
       or v_last is null
       or not (v_last = any (v_claim)) then
      raise exception 'claim_not_valid' using errcode = 'P0001';
    end if;
  end if;

  v_prize := nullif(btrim(coalesce(p_prize_description, '')), '');

  if v_is_jackpot and v_jackpot_amount is not null then
    -- 5. Two decimals when there are pence, none when there are not.
    v_amount_text := to_char(round(v_jackpot_amount, 2), 'FM999,999,990.00');
    if right(v_amount_text, 3) = '.00' then
      v_amount_text := left(v_amount_text, -3);
    end if;
    v_jackpot_text := 'Snowball Jackpot £' || v_amount_text;

    if v_prize is null then
      v_prize := v_jackpot_text;
    elsif position('snowball' in lower(v_prize)) = 0 then
      v_prize := v_prize || ' + ' || v_jackpot_text;
    end if;
  end if;

  -- 4. Stage-specific win text.
  if v_is_jackpot then
    v_display_win_type := 'snowball';
    if v_jackpot_amount is not null then
      v_display_win_text := 'FULL HOUSE + SNOWBALL £' || v_amount_text || '!';
    else
      v_display_win_text := 'FULL HOUSE + SNOWBALL JACKPOT!';
    end if;
  else
    case p_stage
      when 'Line'::public.win_stage then
        v_display_win_type := 'line';
        v_display_win_text := 'LINE WINNER!';
      when 'Two Lines'::public.win_stage then
        v_display_win_type := 'two_lines';
        v_display_win_text := 'TWO LINES WINNER!';
      when 'Full House'::public.win_stage then
        v_display_win_type := 'full_house';
        v_display_win_text := 'FULL HOUSE WINNER!';
      else
        v_display_win_type := 'win';
        v_display_win_text := 'WINNER!';
    end case;
  end if;

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
      client_request_id,
      jackpot_pool_pence
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
      p_client_request_id,
      case when v_is_jackpot and v_jackpot_amount is not null
           then round(v_jackpot_amount * 100)::int end
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

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

revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from public;
revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from anon;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) to authenticated, service_role;

comment on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) is
  'Records a winner atomically with the win announcement. Idempotent on client_request_id, checked first. A new winner needs the valid claim attempt (claim_attempt_id = p_client_request_id, claim_result valid, same stage), re-checked against the board; the only exemption is a manual snowball award inside the open jackpot window. Tied winners share a prize: both components are split by the winners_prize_share_sync trigger, not here.';
