-- Suite F, after M1, M2a and M3 are applied on top of pre-existing data and
-- BEFORE M2b. Two things are proved here:
--
--   1. The backfills. M1 sets started_at on a historic night and leaves
--      completed_at null; M3 records the jackpot pool only where a jackpot_won
--      settlement vouches for it, and moves a jackpot-only row's ordinary pool
--      to 0 so the jackpot is not counted twice.
--   2. Compatibility. M1, M2a and M3 are released before the new host screen,
--      so today's host code must keep working against them: its direct writes
--      to game_states and sessions, record_winner_atomic without any claim
--      attempt, and void_last_number with one argument.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

select set_config('request.jwt.claim.sub', 'e7000000-0000-4000-8000-000000000001', false);

-- ===========================================================================
-- 1. Backfills
-- ===========================================================================
do $$
declare v_session public.sessions;
begin
  select * into v_session from public.sessions where id = 'e7200000-0000-4000-8000-000000000001';
  perform t('staged backfill :: a historic night gets started_at from its earliest game',
            v_session.started_at = '2026-07-01 19:40:00+01', coalesce(v_session.started_at::text, 'null'));
  perform t('staged backfill :: a historic night keeps completed_at null',
            v_session.completed_at is null and v_session.status = 'completed',
            coalesce(v_session.completed_at::text, 'null'));
end $$;

do $$
declare v_settled public.winners; v_unsettled public.winners;
begin
  select * into v_settled from public.winners where client_request_id = 'e7400000-0000-4000-8000-000000000001';
  select * into v_unsettled from public.winners where client_request_id = 'e7400000-0000-4000-8000-000000000002';

  perform t('staged backfill :: a jackpot whose settlement recorded the pot gets that pool and share',
            v_settled.jackpot_pool_pence = 8000 and v_settled.jackpot_share_pence = 8000,
            'pool=' || coalesce(v_settled.jackpot_pool_pence::text, 'null')
              || ' share=' || coalesce(v_settled.jackpot_share_pence::text, 'null'));
  perform t('staged backfill :: its jackpot-only text no longer counts as an ordinary prize too',
            v_settled.prize_amount_pence = 0 and v_settled.prize_share_pence = 0,
            'amount=' || coalesce(v_settled.prize_amount_pence::text, 'null'));
  perform t('staged backfill :: a jackpot with no settlement record keeps an unknown pool, not a guess',
            v_unsettled.jackpot_pool_pence is null and v_unsettled.jackpot_share_pence is null,
            'pool=' || coalesce(v_unsettled.jackpot_pool_pence::text, 'null'));
  perform t('staged backfill :: its ordinary prize is read from the ordinary text',
            v_unsettled.prize_amount_pence = 1000 and v_unsettled.prize_share_pence = 1000,
            'amount=' || coalesce(v_unsettled.prize_amount_pence::text, 'null'));
  perform t('staged backfill :: an ordinary tie is untouched and carries no jackpot',
            (select array_agg(prize_share_pence order by created_at, id) = array[250, 250]
                    and bool_and(jackpot_pool_pence is null and jackpot_share_pence is null)
               from public.winners where game_id = 'e7300000-0000-4000-8000-000000000003'),
            'the tie changed');
end $$;

-- ===========================================================================
-- 2. Today's host code, step by step, as src/app/host/actions.ts writes it
-- ===========================================================================
do $$
declare v_session public.sessions; v_version bigint;
begin
  -- startGame: the state row, then the session, as direct writes.
  insert into public.game_states (
    game_id, number_sequence, called_numbers, numbers_called_count, current_stage_index,
    status, started_at, on_break, paused_for_validation, call_delay_seconds,
    controlling_host_id, controller_last_seen_at
  ) values (
    'e7300000-0000-4000-8000-000000000004', (select jsonb_agg(n order by n) from generate_series(1, 90) n),
    '[]', 0, 0, 'in_progress', now(), false, false, 3,
    'e7000000-0000-4000-8000-000000000001', now()
  );

  select state_version into v_version from public.sessions where id = 'e7200000-0000-4000-8000-000000000002';
  update public.sessions set status = 'running', active_game_id = 'e7300000-0000-4000-8000-000000000004'
   where id = 'e7200000-0000-4000-8000-000000000002'
  returning * into v_session;

  perform t('compat :: startGame''s direct writes still work, and the trigger stamps them',
            v_session.status = 'running' and v_session.state_version = v_version + 1,
            'status=' || v_session.status);
end $$;

do $$
declare i int; s public.game_states;
begin
  for i in 1..6 loop
    s := public.call_next_number('e7300000-0000-4000-8000-000000000004', 0, gen_random_uuid());
  end loop;
  -- supabase-js sends named arguments.
  s := public.void_last_number(p_game_id => 'e7300000-0000-4000-8000-000000000004');
  perform t('compat :: void_last_number with one named argument still resolves and undoes a ball',
            s.numbers_called_count = 5, 'count=' || s.numbers_called_count);
end $$;

do $$
declare v text; s public.game_states; w public.winners;
begin
  -- pauseForValidation, then recordWinner with today's claim key, no attempt.
  update public.game_states set paused_for_validation = true
   where game_id = 'e7300000-0000-4000-8000-000000000004';

  s := public.record_winner_atomic(
    p_session_id => 'e7200000-0000-4000-8000-000000000002',
    p_game_id => 'e7300000-0000-4000-8000-000000000004',
    p_stage => 'Line', p_prize_description => '£10 Cash', p_prize_given => false,
    p_force_snowball_jackpot => false, p_snowball_eligible => false,
    p_client_request_id => 'e7400000-0000-4000-8000-000000000010');
  select * into w from public.winners where client_request_id = 'e7400000-0000-4000-8000-000000000010';

  perform t('compat :: record_winner_atomic without a claim attempt still records (M2b is not applied yet)',
            w.id is not null and w.prize_share_pence = 1000 and w.jackpot_pool_pence is null,
            'no winner row');
  perform t('compat :: the win text is unchanged until M2b', s.display_win_text = 'BINGO!',
            coalesce(s.display_win_text, 'null'));

  -- announceWin writes the display fields directly while paused.
  v := pg_temp.err($q$update public.game_states set display_win_type = 'line', display_win_text = 'LINE WINNER!'
                       where game_id = 'e7300000-0000-4000-8000-000000000004'$q$);
  perform t('compat :: announceWin''s direct write while paused is not blocked by the claim guard',
            v is null, coalesce(v, 'no error'));

  -- resumeGame, advanceToNextStage.
  v := pg_temp.err($q$update public.game_states set paused_for_validation = false, display_win_type = null,
                       display_win_text = null, current_stage_index = 1
                       where game_id = 'e7300000-0000-4000-8000-000000000004'$q$);
  perform t('compat :: resume and advance still write directly', v is null, coalesce(v, 'no error'));
end $$;

do $$
declare v_session public.sessions; v text;
begin
  -- endGame and maybeCompleteSession, as direct writes.
  update public.game_states set status = 'completed', ended_at = now()
   where game_id = 'e7300000-0000-4000-8000-000000000004';
  update public.sessions set status = 'completed', active_game_id = null
   where id = 'e7200000-0000-4000-8000-000000000002'
  returning * into v_session;
  perform t('compat :: completing the session directly stamps completed_at',
            v_session.completed_at is not null, 'completed_at is null');

  update public.sessions set status = 'running' where id = 'e7200000-0000-4000-8000-000000000002'
  returning * into v_session;
  perform t('compat :: an admin re-opening it directly clears completed_at',
            v_session.completed_at is null, 'completed_at kept');

  v := pg_temp.err($q$select * from public.settle_snowball_pot('e7300000-0000-4000-8000-000000000004')$q$);
  perform t('compat :: settle_snowball_pot on a standard game is still a quiet no-op', v is null, coalesce(v, 'no error'));
end $$;
