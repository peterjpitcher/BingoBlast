-- Records what a prize is worth, and what each winner of a shared prize gets.
--
-- THE RULE, decided by the owner on 2026-08-25
--   When two or more people win the same stage of the same game, they SPLIT the
--   prize evenly. Any odd penny goes to whoever was recorded first. That matches
--   the house rule already shown on the pub TV: "Multiple claims share the
--   prize".
--
-- WHY THIS IS NOT THEORETICAL
--   Ten ties already exist in production, and two of them are cash jackpots:
--     game 180a7e41, Full House, two winners, both recorded "£65 Cash Jackpot"
--     game 82690b87, Full House, two winners, both recorded "£110 Cash Jackpot"
--   So the record currently says the pub paid £130 out of a £65 jackpot and £220
--   out of a £110 one. Nothing anywhere said otherwise, because prize_description
--   is free text and no column held a number.
--
-- THE MODEL
--   prize_amount_pence  what THIS row's prize text is worth, parsed from it.
--                       Null when the prize is not money ("Bar of Chocolate").
--   prize_share_pence   what THIS winner actually gets. Equal to the amount when
--                       there is one winner; the even split when the stage is
--                       tied and every row agrees on the prize.
--
--   A stage whose rows DISAGREE about the prize is not one prize being shared,
--   so it is not split: each row keeps its own value. The host can edit the
--   prize text when recording a winner, so this is reachable, and without the
--   rule a "Bar of Chocolate" winner recorded on the same stage as a "£10 Cash"
--   winner would be handed half the cash. That is not a hypothetical: a first
--   version of this migration did exactly that, and the test caught it.
--
--   Both are kept deliberately. Storing only the share would lose what the prize
--   actually was, and storing only the amount would leave every payout total
--   wrong on a tie. With both, a screen can say "£10 Food Voucher, share £5.00"
--   and the truth is visible either way.
--
--   Integer pence, never a float. Money in a float is how you end up paying
--   £4.999999 to somebody.
--
-- THE SNOWBALL JACKPOT SPLITS TOO
--   An earlier migration in this branch made at most one winner per game carry
--   is_snowball_jackpot, on the reasoning that the pot pays and resets once.
--   That reasoning was about the POT mechanics and it does not decide the
--   PAYOUT. With the owner's answer in hand, a tied jackpot is two jackpot
--   winners sharing one pot, which is both what the house rule says and what
--   keeps the pot arithmetic honest: settle_snowball_pot resets once because it
--   only asks whether a jackpot winner exists. So that restriction is lifted
--   here and the share mechanism handles the money instead.
--
--   The call-window check from that migration is NOT lifted. That was a real
--   bypass and it stays closed.
--
-- BACKFILL, AND WHAT IT DOES AND DOES NOT CLAIM
--   Every existing row gets an amount and a share computed under this rule.
--   The amount is a fact read from the text. The SHARE for historic rows is
--   this rule applied retrospectively, not an observation of what the pub
--   actually handed over on the night, and the column comment says so. It is
--   recorded because a consistent rule across the whole history is the only way
--   a payout total means anything, and because the alternative, leaving half the
--   history null, makes every total silently wrong instead of visibly derived.
--
-- ROLLBACK
--   drop trigger winners_prize_share_sync on public.winners;
--   drop function public.sync_prize_shares();
--   drop function public.recompute_prize_shares(uuid, public.win_stage);
--   drop function public.parse_prize_pence(text);
--   alter table public.winners drop column prize_share_pence, drop column prize_amount_pence;

alter table public.winners
  add column if not exists prize_amount_pence int,
  add column if not exists prize_share_pence int;

comment on column public.winners.prize_amount_pence is
  'What this row''s prize text is worth, in pence, parsed from prize_description. Null when the prize is not money. Integer pence, never a float.';

comment on column public.winners.prize_share_pence is
  'What THIS winner actually gets, in pence. Equal to prize_amount_pence for a single winner; an even split with the odd penny to the earliest recorded winner when a stage is tied. For rows created before 2026-08-25 this is the current sharing rule applied retrospectively, not an observation of what was handed over on the night.';

-- ---------------------------------------------------------------------------
-- Reading a money amount out of free text
-- ---------------------------------------------------------------------------
create or replace function public.parse_prize_pence(p_text text)
returns int
language plpgsql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_match text;
begin
  if p_text is null then
    return null;
  end if;

  -- The first pounds amount in the string. Covers every shape the pub actually
  -- uses: "£10 Cash", "£10 Food Voucher", "£110 Cash Jackpot", "Snowball
  -- Jackpot £140", "£1,250", "£12.50". Anything with no £ is not money:
  -- "Bar of Chocolate", "4 tickets to Quiz Night", "Sunday Roast for 2!".
  v_match := substring(p_text from '£[[:space:]]*([0-9][0-9,]*(\.[0-9]{1,2})?)');

  if v_match is null then
    return null;
  end if;

  return round(replace(v_match, ',', '')::numeric * 100)::int;
end;
$function$;

revoke all on function public.parse_prize_pence(text) from public;
revoke all on function public.parse_prize_pence(text) from anon;
grant execute on function public.parse_prize_pence(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The split itself
-- ---------------------------------------------------------------------------
create or replace function public.recompute_prize_shares(
  p_game_id uuid,
  p_stage public.win_stage
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
$function$;

revoke all on function public.recompute_prize_shares(uuid, public.win_stage) from public;
revoke all on function public.recompute_prize_shares(uuid, public.win_stage) from anon;
grant execute on function public.recompute_prize_shares(uuid, public.win_stage) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Keeping it in step, from every direction
-- ---------------------------------------------------------------------------
-- A trigger rather than a call inside record_winner_atomic, because winners are
-- also voided by two separate admin paths that write the table directly. A
-- recompute wired into one writer would be silently wrong for the others, and
-- voiding a tied winner is exactly when the remaining share changes.
create or replace function public.sync_prize_shares()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.recompute_prize_shares(
    coalesce(new.game_id, old.game_id),
    coalesce(new.stage, old.stage)
  );
  return null;
end;
$function$;

revoke all on function public.sync_prize_shares() from public;
revoke all on function public.sync_prize_shares() from anon;
revoke all on function public.sync_prize_shares() from authenticated;

-- Scoped to the columns that can change the answer. Crucially it does NOT fire
-- on prize_share_pence or prize_amount_pence, which is what stops the recompute
-- triggering itself: no depth guard needed, because the recursion cannot start.
drop trigger if exists winners_prize_share_sync on public.winners;
create trigger winners_prize_share_sync
after insert or delete or update of is_void, prize_description, stage, game_id
on public.winners
for each row execute function public.sync_prize_shares();

-- ---------------------------------------------------------------------------
-- The snowball jackpot splits like any other prize
-- ---------------------------------------------------------------------------
-- Lifts only the one-jackpot-winner-per-game restriction added earlier in this
-- branch. The window check it added stays exactly as it is.
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
$function$;

revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from public;
revoke all on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) from anon;
grant execute on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) to authenticated, service_role;

comment on function public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean, uuid) is
  'Records a winner atomically with the win announcement. Idempotent on client_request_id. The snowball jackpot requires the call window to be open on both the eligible and the forced route. Tied winners share a prize: the split is computed by the winners_prize_share_sync trigger, not here.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every stage that already has winners, under the rule above. Cheap: production
-- holds 87 rows.
do $$
declare r record;
begin
  for r in select distinct game_id, stage from public.winners loop
    perform public.recompute_prize_shares(r.game_id, r.stage);
  end loop;
end
$$;
