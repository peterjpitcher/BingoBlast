-- Rollback for 20261001000400_claim_enforcement.sql (M2b). Function
-- definitions only.
--
-- WHAT IT DOES
--   Restores record_winner_atomic to its M3 definition
--   (20261001000300_jackpot_components.sql), copied verbatim: no claim
--   enforcement, the forced snowball flag as before, "BINGO!" win text and the
--   old money text. Hosts on a pre-claim build can record winners again.
--
-- WHAT IT DOES NOT DO
--   It reverses no data. Winners recorded under enforcement stay recorded,
--   with the win text and prize text they were given.
--
-- Tested by suite F in supabase/tests/run.sh.

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

      -- The window is binding on BOTH routes. p_force_snowball_jackpot used to
      -- skip it entirely, which let any host award the full pot at any call
      -- count. That stays closed.
      --
      -- A tie is no longer refused the flag: two people who both get Full House
      -- inside the window are both jackpot winners, and they share the pot. The
      -- pot still resets exactly once, because settle_snowball_pot only asks
      -- whether a jackpot winner exists.
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
  'Records a winner atomically with the win announcement. Idempotent on client_request_id. The snowball jackpot requires the call window to be open on both the eligible and the forced route, and its pool is recorded in jackpot_pool_pence. Tied winners share a prize: both components are split by the winners_prize_share_sync trigger, not here.';
