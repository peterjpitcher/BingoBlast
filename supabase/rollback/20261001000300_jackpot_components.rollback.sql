-- Rollback for 20261001000300_jackpot_components.sql (M3). Function
-- definitions only.
--
-- WHAT IT DOES
--   Restores recompute_prize_shares, record_winner_atomic, settle_snowball_pot
--   and set_winner_prize_given, verbatim as pg_get_functiondef printed them
--   from a replay of every migration up to 20260929103018, with their ACLs and
--   comments, restores the winners_prize_share_sync trigger to its previous
--   column list, and drops list_unsettled_snowball_games, which M3 added and
--   the pre-M3 app never calls. Then it re-derives every stage's amounts and shares under the
--   restored rule, because those columns are maintained by the function being
--   restored and the pre-M3 app totals prize_share_pence alone: without it a
--   jackpot-only row would keep the M3 ordinary pool of 0 and drop out of the
--   old totals.
--
-- WHAT IT DOES NOT DO
--   It drops no column and reverses no money. jackpot_pool_pence and
--   jackpot_share_pence stay with their values and stop being maintained; the
--   pre-M3 app reads neither. A pot settled, a prize ticked as given, or a
--   winner voided stays as it is.
--
-- ORDER
--   Roll back M2b first.
--
-- Tested by suite F in supabase/tests/run.sh.

CREATE OR REPLACE FUNCTION public.recompute_prize_shares(p_game_id uuid, p_stage win_stage)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_live int;
  v_distinct int;
  v_nulls int;
  v_amount int;
  v_base int;
  v_remainder int;
begin
  -- Every row's own amount is a plain fact read from its own text.
  update public.winners
     set prize_amount_pence = public.parse_prize_pence(prize_description)
   where game_id = p_game_id and stage = p_stage
     and prize_amount_pence is distinct from public.parse_prize_pence(prize_description);

  -- Voided wins take no share. They keep their amount, so the record still
  -- shows what the claim had been for.
  update public.winners
     set prize_share_pence = null
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_void, false) = true
     and prize_share_pence is not null;

  select count(*),
         count(distinct prize_amount_pence),
         count(*) filter (where prize_amount_pence is null)
    into v_live, v_distinct, v_nulls
    from public.winners
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_void, false) = false;

  if v_live = 0 then
    return;
  end if;

  -- Splitting only makes sense when everyone on this stage won the SAME prize,
  -- which is the normal case because the text is filled from games.prizes. If
  -- the rows disagree, they are evidently not one prize being shared, and
  -- averaging them would invent a number nobody agreed to. The host can edit
  -- the prize text when recording a winner, so this is reachable: without this
  -- branch, a "Bar of Chocolate" winner recorded on the same stage as a "£10
  -- Cash" winner would be given half the cash.
  if v_distinct <> 1 or v_nulls > 0 then
    update public.winners
       set prize_share_pence = prize_amount_pence
     where game_id = p_game_id and stage = p_stage
       and coalesce(is_void, false) = false
       and prize_share_pence is distinct from prize_amount_pence;
    return;
  end if;

  select max(prize_amount_pence) into v_amount
    from public.winners
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_void, false) = false;

  v_base := v_amount / v_live;                 -- integer division, floors
  v_remainder := v_amount - (v_base * v_live); -- 0 to v_live - 1 pence

  -- The odd penny goes to whoever was recorded first. Ordering by created_at
  -- then id so two wins recorded in the same millisecond still order the same
  -- way every time this runs, which matters because it runs again on every
  -- later change to the stage.
  with ranked as (
    select id, row_number() over (order by created_at, id) as rn
      from public.winners
     where game_id = p_game_id and stage = p_stage
       and coalesce(is_void, false) = false
  )
  update public.winners w
     set prize_share_pence = v_base + case when r.rn = 1 then v_remainder else 0 end
    from ranked r
   where w.id = r.id
     and w.prize_share_pence is distinct from (v_base + case when r.rn = 1 then v_remainder else 0 end);
end;
$function$

;

revoke all on function public.recompute_prize_shares(uuid, public.win_stage) from public;
revoke all on function public.recompute_prize_shares(uuid, public.win_stage) from anon;
grant execute on function public.recompute_prize_shares(uuid, public.win_stage) to authenticated, service_role;

-- New in M3 and read only; nothing before M3 calls it.
drop function if exists public.list_unsettled_snowball_games(uuid);

drop trigger if exists winners_prize_share_sync on public.winners;
create trigger winners_prize_share_sync
after insert or delete or update of is_void, prize_description, stage, game_id
on public.winners
for each row execute function public.sync_prize_shares();

CREATE OR REPLACE FUNCTION public.record_winner_atomic(p_session_id uuid, p_game_id uuid, p_stage win_stage, p_prize_description text DEFAULT NULL::text, p_prize_given boolean DEFAULT false, p_force_snowball_jackpot boolean DEFAULT false, p_snowball_eligible boolean DEFAULT false, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS public.game_states
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from public;
revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from anon;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) to authenticated, service_role;

comment on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) is
  'Records a winner atomically with the win announcement. Idempotent on client_request_id. The snowball jackpot requires the call window to be open on both the eligible and the forced route. Tied winners share a prize: the split is computed by the winners_prize_share_sync trigger, not here.';

CREATE OR REPLACE FUNCTION public.settle_snowball_pot(p_game_id uuid)
 RETURNS TABLE(outcome text, settlement text, pot_id uuid, new_max_calls integer, new_jackpot_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_game public.games;
  v_is_test boolean;
  v_pot public.snowball_pots;
  v_jackpot_won boolean;
  v_settlement text;
  v_new_max_calls int;
  v_new_jackpot numeric;
begin
  perform public.assert_is_host();

  select * into v_game from public.games where id = p_game_id;

  if v_game.id is null then
    raise exception 'game_not_found';
  end if;

  select coalesce(is_test_session, false) into v_is_test
    from public.sessions
   where id = v_game.session_id;

  if coalesce(v_is_test, false) then
    return query select 'test_session'::text, null::text, null::uuid, null::int, null::numeric;
    return;
  end if;

  if v_game.type is distinct from 'snowball'::public.game_type
     or v_game.snowball_pot_id is null then
    return query select 'not_snowball'::text, null::text, null::uuid, null::int, null::numeric;
    return;
  end if;

  -- The lock. It serialises settlement of this pot, which is what makes the
  -- read-modify-write below correct: two different games ending on the same pot
  -- at the same moment roll over one after the other, not on top of each other.
  select * into v_pot
    from public.snowball_pots
   where id = v_game.snowball_pot_id
   for update;

  if v_pot.id is null then
    raise exception 'snowball_pot_not_found';
  end if;

  -- Won or not decides reset vs rollover. Voided winners do not count.
  select exists (
    select 1 from public.winners
     where game_id = p_game_id
       and coalesce(is_snowball_jackpot, false)
       and coalesce(is_void, false) = false
  ) into v_jackpot_won;

  -- Both new values come from the locked pot row and nowhere else.
  if v_jackpot_won then
    v_settlement := 'reset';
    v_new_max_calls := v_pot.base_max_calls;
    v_new_jackpot := v_pot.base_jackpot_amount;
  else
    v_settlement := 'rollover';
    v_new_max_calls := v_pot.current_max_calls + v_pot.calls_increment;
    v_new_jackpot := v_pot.current_jackpot_amount + v_pot.jackpot_increment;
  end if;

  -- Claim the settlement first. The partial unique index on
  -- (snowball_pot_id, game_id) turns a second attempt for this game into a
  -- unique violation, caught here so the pot is left exactly where it is.
  begin
    insert into public.snowball_pot_history (
      snowball_pot_id,
      game_id,
      change_type,
      old_val_max,
      new_val_max,
      old_val_jackpot,
      new_val_jackpot,
      changed_by
    ) values (
      v_pot.id,
      p_game_id,
      case when v_jackpot_won then 'jackpot_won' else 'rollover' end,
      v_pot.current_max_calls,
      v_new_max_calls,
      v_pot.current_jackpot_amount,
      v_new_jackpot,
      auth.uid()
    );
  exception when unique_violation then
    -- Already settled, most likely a completed game re-opened and ended again.
    -- settlement is null because this call moved nothing; the values returned are
    -- the pot as it actually stands, read under the lock.
    return query select 'already_settled'::text,
                        null::text,
                        v_pot.id::uuid,
                        v_pot.current_max_calls::int,
                        v_pot.current_jackpot_amount::numeric;
    return;
  end;

  -- Same transaction as the claim, so the documented "claim landed, pot did not
  -- move" gap cannot happen any more. last_awarded_at only moves on a reset.
  update public.snowball_pots
     set current_max_calls = v_new_max_calls,
         current_jackpot_amount = v_new_jackpot,
         last_awarded_at = case when v_jackpot_won then now() else last_awarded_at end
   where id = v_pot.id;

  return query select 'settled'::text,
                      v_settlement::text,
                      v_pot.id::uuid,
                      v_new_max_calls::int,
                      v_new_jackpot::numeric;
end;
$function$

;

revoke all on function public.settle_snowball_pot(uuid) from public;
revoke all on function public.settle_snowball_pot(uuid) from anon;
grant execute on function public.settle_snowball_pot(uuid) to authenticated;
grant execute on function public.settle_snowball_pot(uuid) to service_role;

comment on function public.settle_snowball_pot(uuid) is
  'Settles the snowball pot for a finished game: reset if the jackpot was won, rollover if not. Host-callable by design, so RLS on snowball_pots and snowball_pot_history can stay admin-only. Every written value is derived from the locked pot row, never supplied by the caller. Once per game, guarded by snowball_pot_history_pot_game_unique.';

CREATE OR REPLACE FUNCTION public.set_winner_prize_given(p_winner_id uuid, p_session_id uuid, p_prize_given boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id uuid;
  v_prize_given boolean;
begin
  perform public.assert_is_host();

  if p_prize_given is null then
    raise exception 'invalid_prize_given';
  end if;

  -- The lock makes the existence and session prechecks binding for the update
  -- below, the same way the host hot-path functions do it.
  select session_id into v_session_id
  from public.winners
  where id = p_winner_id
  for update;

  if not found then
    raise exception 'winner_not_found';
  end if;

  if v_session_id is distinct from p_session_id then
    raise exception 'wrong_session';
  end if;

  update public.winners
  set prize_given = p_prize_given
  where id = p_winner_id
  returning prize_given into v_prize_given;

  -- Returning the persisted value rather than the argument is what makes a write
  -- that did not land visible to the caller. That is the point of this change:
  -- a silent false success on a money-adjacent flag is worse than an error.
  return coalesce(v_prize_given, false);
end;
$function$

;

revoke all on function public.set_winner_prize_given(uuid, uuid, boolean) from public;
revoke all on function public.set_winner_prize_given(uuid, uuid, boolean) from anon;
grant execute on function public.set_winner_prize_given(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_winner_prize_given(uuid, uuid, boolean) to service_role;

comment on column public.winners.prize_amount_pence is
  'What this row''s prize text is worth, in pence, parsed from prize_description. Null when the prize is not money. Integer pence, never a float.';

comment on column public.winners.prize_share_pence is
  'What THIS winner actually gets, in pence. Equal to prize_amount_pence for a single winner; an even split with the odd penny to the earliest recorded winner when a stage is tied. For rows created before 2026-08-25 this is the current sharing rule applied retrospectively, not an observation of what was handed over on the night.';

-- Re-derive the maintained columns under the restored rule.
do $$
declare r record;
begin
  for r in select distinct game_id, stage from public.winners loop
    perform public.recompute_prize_shares(r.game_id, r.stage);
  end loop;
end
$$;
