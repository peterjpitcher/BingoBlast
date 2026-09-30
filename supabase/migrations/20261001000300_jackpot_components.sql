-- M3: the snowball jackpot as its own money component.
--
-- WHY
--   A jackpot winner's prize_description is the ordinary prize with the
--   jackpot appended ("£10 Cash + Snowball Jackpot £140"), and the whole text
--   was parsed as one amount. So the jackpot either vanished from the money
--   (the first £ amount was the ordinary prize) or was counted as the ordinary
--   prize when there was none ("Snowball Jackpot £140", "£140 (Manual Snowball
--   Win)"), and a tie between an eligible and an ineligible winner split the
--   jackpot with somebody who was not eligible for it.
--
-- THE MODEL (spec 7, M3; assumption A2)
--   prize_amount_pence   the ORDINARY pool of this row: what the ordinary prize
--                        text is worth, before any jackpot text was appended.
--                        A jackpot-only description ("Snowball Jackpot £140",
--                        or a host text that already names the snowball, which
--                        record_winner_atomic never appends to) is 0. Null when
--                        the ordinary prize is not money.
--   prize_share_pence    the ordinary share, split between ALL live winners of
--                        the stage when they agree on the prize, as before.
--   jackpot_pool_pence   new: the pot amount, taken under the pot lock when the
--                        jackpot winner was recorded. Null on every row that is
--                        not a jackpot winner, and on historic jackpot rows the
--                        settlement history cannot vouch for.
--   jackpot_share_pence  new: the jackpot split between the live (non-void)
--                        jackpot winners of the stage only; the odd penny goes to
--                        the earliest by created_at, then id. Null for everyone
--                        else, for a voided winner, and where the pool is null.
--   A winner's total is prize_share_pence + jackpot_share_pence.
--
--   The recompute on insert, void and edit covers both components. It still
--   runs from the winners_prize_share_sync trigger, now also on changes to
--   is_snowball_jackpot and jackpot_pool_pence.
--
-- ALSO
--   settle_snowball_pot refuses unless the game is completed (X7), checked
--   under a share lock on the game_states row, so a re-open cannot slip in.
--   set_winner_prize_given refuses a voided winner (X14).
--
-- COMPATIBILITY
--   record_winner_atomic keeps its signature, its display text and its
--   behaviour for today's host screen; it only also writes the jackpot pool.
--
-- BACKFILL
--   jackpot_pool_pence for historic jackpot winners, only from a 'jackpot_won'
--   settlement history row for the same game, whose old_val_jackpot is the pot
--   the win emptied. Anything else stays null and the screens say "jackpot
--   amount not recorded". Nothing is guessed from today's pot. Every stage is
--   then recomputed under the new rule; only jackpot rows can change.
--
-- ERROR KEYS (errcode P0001)
--   game_not_completed   settle_snowball_pot on a game that is not completed
--   winner_void          set_winner_prize_given on a voided winner
--   record_winner_atomic, settle_snowball_pot and set_winner_prize_given keep
--   every key they raised before.
--
-- IDEMPOTENT: yes.
--
-- ROLLBACK: supabase/rollback/20261001000300_jackpot_components.rollback.sql
-- restores the previous functions and trigger. The columns and data stay.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.winners
  add column if not exists jackpot_pool_pence integer,
  add column if not exists jackpot_share_pence integer;

comment on column public.winners.prize_amount_pence is
  'The ordinary prize pool of this row, in pence: what the ordinary prize text is worth, before any snowball jackpot text was appended. 0 for a jackpot-only description; null when the prize is not money. Maintained by the winners_prize_share_sync trigger.';

comment on column public.winners.prize_share_pence is
  'The ordinary share this winner gets, in pence. Equal to prize_amount_pence for a single winner; an even split with the odd penny to the earliest recorded winner when a stage is tied and every row agrees on the prize. Null for a voided win and for a prize that is not money. The jackpot is NOT in here: add jackpot_share_pence for the total.';

comment on column public.winners.jackpot_pool_pence is
  'The snowball jackpot this winner shared in, in pence: the pot amount under the pot lock when the win was recorded. Null when the row is not a jackpot winner, and on jackpot rows from before 2026-10-01 unless a jackpot_won settlement for the game records the amount.';

comment on column public.winners.jackpot_share_pence is
  'This winner''s share of the jackpot, in pence: the pool split between the non-void jackpot winners of the stage, odd penny to the earliest. Null for everyone else, for a voided winner, and where the pool is unknown.';

-- ---------------------------------------------------------------------------
-- The split, both components
-- ---------------------------------------------------------------------------
create or replace function public.recompute_prize_shares(
  p_game_id uuid,
  p_stage public.win_stage
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_suffix constant text := ' \+ Snowball Jackpot £[0-9][0-9,]*(\.[0-9]{1,2})?$';
  v_live int;
  v_distinct int;
  v_nulls int;
  v_amount int;
  v_base int;
  v_remainder int;
begin
  -- Every row's ordinary amount is read from its own text. A jackpot row's
  -- ordinary text is what record_winner_atomic appended the jackpot to; when it
  -- appended nothing, because there was no ordinary text or the host's text
  -- already named the snowball, the row is jackpot-only and its ordinary pool
  -- is 0, so the jackpot is never counted twice.
  with parsed as (
    select w.id,
           case
             when not coalesce(w.is_snowball_jackpot, false) then
               public.parse_prize_pence(w.prize_description)
             when w.prize_description ~ v_suffix
                  and position('snowball' in lower(regexp_replace(w.prize_description, v_suffix, ''))) = 0 then
               public.parse_prize_pence(regexp_replace(w.prize_description, v_suffix, ''))
             else 0
           end as amount
      from public.winners w
     where w.game_id = p_game_id and w.stage = p_stage
  )
  update public.winners w
     set prize_amount_pence = p.amount
    from parsed p
   where w.id = p.id
     and w.prize_amount_pence is distinct from p.amount;

  -- Voided wins take no share of either component. They keep their amounts,
  -- so the record still shows what the claim had been for.
  update public.winners
     set prize_share_pence = null,
         jackpot_share_pence = null
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_void, false) = true
     and (prize_share_pence is not null or jackpot_share_pence is not null);

  -- Only a live jackpot winner takes a jackpot share (A2).
  update public.winners
     set jackpot_share_pence = null
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_snowball_jackpot, false) = false
     and jackpot_share_pence is not null;

  -- ---- The ordinary component: shared between every live winner ----------
  select count(*),
         count(distinct prize_amount_pence),
         count(*) filter (where prize_amount_pence is null)
    into v_live, v_distinct, v_nulls
    from public.winners
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_void, false) = false;

  if v_live > 0 then
    -- Splitting only makes sense when everyone on this stage won the SAME
    -- prize. If the rows disagree they are not one prize being shared, and
    -- each keeps its own value.
    if v_distinct <> 1 or v_nulls > 0 then
      update public.winners
         set prize_share_pence = prize_amount_pence
       where game_id = p_game_id and stage = p_stage
         and coalesce(is_void, false) = false
         and prize_share_pence is distinct from prize_amount_pence;
    else
      select max(prize_amount_pence) into v_amount
        from public.winners
       where game_id = p_game_id and stage = p_stage
         and coalesce(is_void, false) = false;

      v_base := v_amount / v_live;
      v_remainder := v_amount - (v_base * v_live);

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
    end if;
  end if;

  -- ---- The jackpot component: shared between the live jackpot winners ----
  select count(*),
         count(distinct jackpot_pool_pence),
         count(*) filter (where jackpot_pool_pence is null)
    into v_live, v_distinct, v_nulls
    from public.winners
   where game_id = p_game_id and stage = p_stage
     and coalesce(is_void, false) = false
     and coalesce(is_snowball_jackpot, false) = true;

  if v_live > 0 then
    if v_distinct <> 1 or v_nulls > 0 then
      -- Pools that disagree, or an unknown pool, are not split: each row keeps
      -- its own pool, and an unknown one stays unknown.
      update public.winners
         set jackpot_share_pence = jackpot_pool_pence
       where game_id = p_game_id and stage = p_stage
         and coalesce(is_void, false) = false
         and coalesce(is_snowball_jackpot, false) = true
         and jackpot_share_pence is distinct from jackpot_pool_pence;
    else
      select max(jackpot_pool_pence) into v_amount
        from public.winners
       where game_id = p_game_id and stage = p_stage
         and coalesce(is_void, false) = false
         and coalesce(is_snowball_jackpot, false) = true;

      v_base := v_amount / v_live;
      v_remainder := v_amount - (v_base * v_live);

      with ranked as (
        select id, row_number() over (order by created_at, id) as rn
          from public.winners
         where game_id = p_game_id and stage = p_stage
           and coalesce(is_void, false) = false
           and coalesce(is_snowball_jackpot, false) = true
      )
      update public.winners w
         set jackpot_share_pence = v_base + case when r.rn = 1 then v_remainder else 0 end
        from ranked r
       where w.id = r.id
         and w.jackpot_share_pence is distinct from (v_base + case when r.rn = 1 then v_remainder else 0 end);
    end if;
  end if;
end;
$function$;

revoke all on function public.recompute_prize_shares(uuid, public.win_stage) from public;
revoke all on function public.recompute_prize_shares(uuid, public.win_stage) from anon;
grant execute on function public.recompute_prize_shares(uuid, public.win_stage) to authenticated, service_role;

-- The trigger also fires when the jackpot flag or the pool changes. Still not
-- on any column the recompute writes, so it cannot trigger itself.
drop trigger if exists winners_prize_share_sync on public.winners;
create trigger winners_prize_share_sync
after insert or delete or update of is_void, prize_description, stage, game_id,
  is_snowball_jackpot, jackpot_pool_pence
on public.winners
for each row execute function public.sync_prize_shares();

-- ---------------------------------------------------------------------------
-- record_winner_atomic: the body from 20260825080608 with one change, the
-- jackpot pool written from the pot amount taken under the pot lock. The
-- ordinary pool follows from the ordinary text through the trigger above.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- settle_snowball_pot: the body from 20260730065531, refusing unless the game
-- is completed (X7). The check sits after the two no-op outcomes, which move
-- nothing, and before the pot lock; the share lock on game_states keeps a
-- re-open out until this commits. Lock order game_states then pot, the same
-- as record_winner_atomic.
-- ---------------------------------------------------------------------------
create or replace function public.settle_snowball_pot(p_game_id uuid)
returns table (
  outcome text,
  settlement text,
  pot_id uuid,
  new_max_calls int,
  new_jackpot_amount numeric
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_game public.games;
  v_is_test boolean;
  v_game_status public.game_status;
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

  select gs.status into v_game_status
    from public.game_states gs
   where gs.game_id = p_game_id
   for share;

  if v_game_status is distinct from 'completed'::public.game_status then
    raise exception 'game_not_completed' using errcode = 'P0001';
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
$function$;

revoke all on function public.settle_snowball_pot(uuid) from public;
revoke all on function public.settle_snowball_pot(uuid) from anon;
grant execute on function public.settle_snowball_pot(uuid) to authenticated;
grant execute on function public.settle_snowball_pot(uuid) to service_role;

comment on function public.settle_snowball_pot(uuid) is
  'Settles the snowball pot for a finished game: reset if the jackpot was won, rollover if not. Refuses game_not_completed unless the game is completed. Host-callable by design, so RLS on snowball_pots and snowball_pot_history can stay admin-only. Every written value is derived from the locked pot row, never supplied by the caller. Once per game, guarded by snowball_pot_history_pot_game_unique.';

-- ---------------------------------------------------------------------------
-- set_winner_prize_given: the body from 20260730065446, refusing a voided
-- winner (X14) in either direction, under the same row lock.
-- ---------------------------------------------------------------------------
create or replace function public.set_winner_prize_given(
  p_winner_id uuid,
  p_session_id uuid,
  p_prize_given boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_session_id uuid;
  v_is_void boolean;
  v_prize_given boolean;
begin
  perform public.assert_is_host();

  if p_prize_given is null then
    raise exception 'invalid_prize_given';
  end if;

  -- The lock makes the existence and session prechecks binding for the update
  -- below, the same way the host hot-path functions do it.
  select session_id, is_void into v_session_id, v_is_void
  from public.winners
  where id = p_winner_id
  for update;

  if not found then
    raise exception 'winner_not_found';
  end if;

  if v_session_id is distinct from p_session_id then
    raise exception 'wrong_session';
  end if;

  if coalesce(v_is_void, false) then
    raise exception 'winner_void' using errcode = 'P0001';
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
$function$;

revoke all on function public.set_winner_prize_given(uuid, uuid, boolean) from public;
revoke all on function public.set_winner_prize_given(uuid, uuid, boolean) from anon;
grant execute on function public.set_winner_prize_given(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_winner_prize_given(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- The jackpot pool, only where a jackpot_won settlement for the same game
-- records the pot that the win emptied. The trigger recomputes the stage.
do $$
declare
  v_rows int;
  r record;
begin
  update public.winners w
     set jackpot_pool_pence = round(h.old_val_jackpot * 100)::int
    from public.snowball_pot_history h
   where coalesce(w.is_snowball_jackpot, false)
     and w.jackpot_pool_pence is null
     and h.game_id = w.game_id
     and h.change_type = 'jackpot_won'
     and h.old_val_jackpot is not null;

  get diagnostics v_rows = row_count;
  raise notice 'jackpot_components: backfilled jackpot_pool_pence on % row(s) from settlement history', v_rows;

  -- Every stage under the new rule. Only jackpot rows can come out different,
  -- and a rerun changes nothing.
  for r in select distinct game_id, stage from public.winners loop
    perform public.recompute_prize_shares(r.game_id, r.stage);
  end loop;
end
$$;
