-- Behavioural assertions for the remediation, run against the fully replayed
-- database in SUITE D of supabase/tests/run.sh.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM replay.test.sql
--   That file asserts the CATALOGUE: which objects exist, which grants they
--   carry, which policies are attached. This file asserts BEHAVIOUR: it creates
--   a staff account, a session, a game and a pot, acts as that host, and checks
--   what the functions actually do. A catalogue assertion cannot tell you that a
--   retried call draws a second ball; only calling it twice can.
--
--   Every scenario here is a bug that was live in production on 2026-08-25.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed uuids so a failure detail is greppable.
-- ---------------------------------------------------------------------------
\set host_id '''11111111-1111-4111-8111-111111111111'''
\set pending_id '''22222222-2222-4222-8222-222222222222'''
\set session_id '''55555555-5555-4555-8555-555555555555'''
\set game_id '''77777777-7777-4777-8777-777777777777'''
\set pot_id '''99999999-9999-4999-8999-999999999999'''

-- The trigger creates the profile as 'pending'; the admin promotion is the
-- deliberate second step, which is exactly the flow being tested.
insert into auth.users (id, email) values (:host_id, 'host@example.invalid');
insert into auth.users (id, email) values (:pending_id, 'pending@example.invalid');
update public.profiles set role = 'admin' where id = :host_id;

insert into public.snowball_pots (
  id, name, base_max_calls, base_jackpot_amount, calls_increment, jackpot_increment,
  current_max_calls, current_jackpot_amount
) values (:pot_id, 'Test Pot', 40, 20, 2, 20, 44, 140);

insert into public.sessions (id, name, status, is_test_session)
values (:session_id, 'Test Night', 'running', false);

insert into public.games (id, session_id, game_index, name, type, stage_sequence, snowball_pot_id, prizes)
values (:game_id, :session_id, 1, 'Snowball', 'snowball', '["Full House"]'::jsonb, :pot_id, '{"Full House": "The pot"}'::jsonb);

-- A full bag, in order, so the expected ball is predictable.
insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, controller_last_seen_at, started_at
)
select :game_id,
       (select jsonb_agg(n) from generate_series(1, 90) n),
       '[]'::jsonb, 0, 0, 'in_progress', :host_id, now(), now();

-- Act as the host for everything below.
select set_config('request.jwt.claim.sub', :host_id, false);

-- ===========================================================================
-- The pending role is inert
-- ===========================================================================
do $$
declare v_role text;
begin
  select role::text into v_role from public.profiles
   where id = '22222222-2222-4222-8222-222222222222';
  perform t('pending :: the trigger creates a new account as pending, not host',
            v_role = 'pending',
            'handle_new_user produced ' || coalesce(v_role, '(no row)'));
end $$;

do $$
declare v_raised boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
  begin
    perform public.assert_is_host();
  exception when others then
    v_raised := true;
  end;
  perform t('pending :: assert_is_host refuses a pending account', v_raised,
            'a pending account must not pass the host guard');
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
end $$;

-- ===========================================================================
-- call_next_number idempotency. THE bug: a retry after a lost response drew a
-- second ball, so two came out of the bag and one was never announced.
-- ===========================================================================
do $$
declare
  v_key uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_first public.game_states;
  v_retry public.game_states;
begin
  v_first := public.call_next_number('77777777-7777-4777-8777-777777777777', 0, v_key);
  v_retry := public.call_next_number('77777777-7777-4777-8777-777777777777', 0, v_key);

  perform t('call :: the first call draws one ball',
            v_first.numbers_called_count = 1,
            'count was ' || v_first.numbers_called_count);

  perform t('call :: a retry carrying the SAME key draws nothing',
            v_retry.numbers_called_count = 1,
            'count after the retry was ' || v_retry.numbers_called_count
              || ': a lost response must not cost a second ball');

  perform t('call :: the retry returns the same board, not an error',
            v_retry.called_numbers = v_first.called_numbers,
            'called_numbers changed on a retry');
end $$;

do $$
declare
  v_state public.game_states;
begin
  v_state := public.call_next_number('77777777-7777-4777-8777-777777777777', 0,
                                     'aaaaaaaa-0000-4000-8000-000000000002');
  perform t('call :: a NEW key draws the next ball',
            v_state.numbers_called_count = 2,
            'count was ' || v_state.numbers_called_count);
end $$;

do $$
declare
  v_state public.game_states;
begin
  -- A null key means "not idempotent", which is the pre-existing behaviour and
  -- must keep working so an older client is never worse off than it was.
  v_state := public.call_next_number('77777777-7777-4777-8777-777777777777', 0, null);
  perform t('call :: a null key still draws, so an older client is not broken',
            v_state.numbers_called_count = 3,
            'count was ' || v_state.numbers_called_count);
end $$;

-- ===========================================================================
-- void_last_number clears the key, so the ball can be drawn again
-- ===========================================================================
do $$
declare
  v_state public.game_states;
begin
  v_state := public.void_last_number('77777777-7777-4777-8777-777777777777');
  perform t('void :: undoing a ball puts it back in the bag',
            v_state.numbers_called_count = 2,
            'count was ' || v_state.numbers_called_count);
  perform t('void :: undoing clears the call idempotency key',
            v_state.last_call_request_id is null,
            'a stale key on an undone call would refuse the re-draw');
end $$;

-- ===========================================================================
-- The snowball jackpot window. THE bug: p_force_snowball_jackpot skipped the
-- window check entirely, so any host could pay the full pot at any call count.
-- ===========================================================================

-- Push the board past the 44 call window.
do $$
declare i int;
begin
  for i in 1..50 loop
    perform public.call_next_number('77777777-7777-4777-8777-777777777777', 0, gen_random_uuid());
  end loop;
end $$;

do $$
declare
  v_count int;
  v_is_jackpot boolean;
begin
  select numbers_called_count into v_count from public.game_states
   where game_id = '77777777-7777-4777-8777-777777777777';

  perform t('jackpot :: the board is past the window before this test',
            v_count > 44, 'count is ' || v_count || ', pot window is 44');

  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    '77777777-7777-4777-8777-777777777777',
    'Full House'::public.win_stage,
    null, false,
    true,   -- p_force_snowball_jackpot: the flag that used to skip the window
    true,
    'bbbbbbbb-0000-4000-8000-000000000001'
  );

  select is_snowball_jackpot into v_is_jackpot from public.winners
   where client_request_id = 'bbbbbbbb-0000-4000-8000-000000000001';

  perform t('jackpot :: a FORCED award outside the window is NOT a jackpot',
            v_is_jackpot = false,
            'the force flag must not bypass the call window; is_snowball_jackpot was '
              || coalesce(v_is_jackpot::text, 'null'));
end $$;

-- Now inside the window, on a second game, and prove the tie rule.
\set game2_id '''88888888-8888-4888-8888-888888888888'''
insert into public.games (id, session_id, game_index, name, type, stage_sequence, snowball_pot_id, prizes)
values (:game2_id, :session_id, 2, 'Snowball 2', 'snowball', '["Full House"]'::jsonb, :pot_id, '{"Full House": "The pot"}'::jsonb);

insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, controller_last_seen_at, started_at
)
select :game2_id,
       (select jsonb_agg(n) from generate_series(1, 90) n),
       (select jsonb_agg(n) from generate_series(1, 10) n),
       10, 0, 'in_progress', :host_id, now(), now();

do $$
declare
  v_first boolean;
  v_second boolean;
begin
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    '88888888-8888-4888-8888-888888888888',
    'Full House'::public.win_stage,
    null, false, false, true,
    'bbbbbbbb-0000-4000-8000-000000000002'
  );

  select is_snowball_jackpot into v_first from public.winners
   where client_request_id = 'bbbbbbbb-0000-4000-8000-000000000002';

  perform t('jackpot :: an eligible claim INSIDE the window is a jackpot',
            v_first = true,
            'is_snowball_jackpot was ' || coalesce(v_first::text, 'null'));

  -- A tie: a second valid Full House on the same game and the same ball.
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    '88888888-8888-4888-8888-888888888888',
    'Full House'::public.win_stage,
    null, false, false, true,
    'bbbbbbbb-0000-4000-8000-000000000003'
  );

  select is_snowball_jackpot into v_second from public.winners
   where client_request_id = 'bbbbbbbb-0000-4000-8000-000000000003';

  perform t('jackpot :: a tied SECOND winner is recorded but does not carry the jackpot',
            v_second = false,
            'the pot pays and resets once, so the record must not claim two full jackpots; was '
              || coalesce(v_second::text, 'null'));

  perform t('jackpot :: the tied second winner is still recorded as a winner',
            (select count(*) = 2 from public.winners
              where game_id = '88888888-8888-4888-8888-888888888888'),
            'a tie is two valid wins, whatever the jackpot rule');
end $$;

-- ===========================================================================
-- Manual pot adjustment writes its audit row in the same transaction, and only
-- when the money actually moves.
-- ===========================================================================
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.snowball_pot_history;

  perform public.update_snowball_pot_safe(
    '99999999-9999-4999-8999-999999999999',
    'Test Pot Renamed', 40, 20, 2, 20, 44, 140  -- current figures UNCHANGED
  );

  select count(*) into v_after from public.snowball_pot_history;
  perform t('pot :: renaming a pot writes no audit row, because no money moved',
            v_after = v_before,
            'history went from ' || v_before || ' to ' || v_after);

  perform public.update_snowball_pot_safe(
    '99999999-9999-4999-8999-999999999999',
    'Test Pot Renamed', 40, 20, 2, 20, 46, 160  -- current figures CHANGED
  );

  select count(*) into v_after from public.snowball_pot_history;
  perform t('pot :: moving the current figures always writes an audit row',
            v_after = v_before + 1,
            'history went from ' || v_before || ' to ' || v_after
              || ': a pot must never move unrecorded');
end $$;

-- Both the reset and the archive refuse while a game on the pot is unfinished,
-- which is the point of them. Prove the refusal first, then finish the games,
-- then prove the success. Running these in the other order is what a first pass
-- at this file did, and the suite stopped on its own guard.
do $$
declare v_raised boolean := false;
begin
  begin
    perform public.reset_snowball_pot_safe('99999999-9999-4999-8999-999999999999');
  exception when others then
    v_raised := true;
  end;
  perform t('pot :: a reset refuses while a game on the pot has not finished', v_raised,
            'resetting mid-game moves the jackpot figure out from under the host announcing it');
end $$;

do $$
declare v_raised boolean := false;
begin
  begin
    perform public.archive_snowball_pot('99999999-9999-4999-8999-999999999999');
  exception when others then
    v_raised := true;
  end;
  perform t('archive :: refuses while a game on the pot has not finished', v_raised,
            'both test games are still in_progress');
end $$;

update public.game_states set status = 'completed'
 where game_id in ('77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888');

do $$
declare v_pot public.snowball_pots; v_last_awarded timestamptz; v_after timestamptz;
begin
  select last_awarded_at into v_last_awarded from public.snowball_pots
   where id = '99999999-9999-4999-8999-999999999999';

  perform public.reset_snowball_pot_safe('99999999-9999-4999-8999-999999999999');
  select * into v_pot from public.snowball_pots where id = '99999999-9999-4999-8999-999999999999';

  perform t('pot :: a reset returns the current figures to base',
            v_pot.current_max_calls = v_pot.base_max_calls
              and v_pot.current_jackpot_amount = v_pot.base_jackpot_amount,
            'current is ' || v_pot.current_max_calls || '/' || v_pot.current_jackpot_amount);

  select last_awarded_at into v_after from public.snowball_pots
   where id = '99999999-9999-4999-8999-999999999999';
  perform t('pot :: a reset does NOT clear last_awarded_at',
            v_after is not distinct from v_last_awarded,
            'the column records when the jackpot was last won, which a manual correction does not change');
end $$;

-- ===========================================================================
-- Archiving a pot, rather than deleting it and its history
-- ===========================================================================
do $$
declare v_pot public.snowball_pots; v_history int;
begin
  v_pot := public.archive_snowball_pot('99999999-9999-4999-8999-999999999999');
  perform t('archive :: succeeds once every game on the pot has finished',
            v_pot.archived_at is not null, 'archived_at is null');

  select count(*) into v_history from public.snowball_pot_history
   where snowball_pot_id = '99999999-9999-4999-8999-999999999999';
  perform t('archive :: the pot history survives, because it is the audit trail for real cash',
            v_history > 0, 'history rows: ' || v_history);

  v_pot := public.archive_snowball_pot('99999999-9999-4999-8999-999999999999');
  perform t('archive :: archiving twice is not an error', v_pot.id is not null,
            'a retry of a request that lost its response must not look like a failure');
end $$;

-- ===========================================================================
-- Resetting a session: records what it destroys, and refuses when it would
-- strand the pot.
-- ===========================================================================
do $$
declare v_raised boolean := false; v_msg text;
begin
  -- Game 2 settled the pot when the jackpot was won, so a history row claims it.
  insert into public.snowball_pot_history (snowball_pot_id, game_id, change_type)
  values ('99999999-9999-4999-8999-999999999999', '88888888-8888-4888-8888-888888888888', 'jackpot_won')
  on conflict do nothing;

  begin
    perform public.reset_session_safe('55555555-5555-4555-8555-555555555555');
  exception when others then
    v_raised := true;
    get stacked diagnostics v_msg = message_text;
  end;

  perform t('reset :: refuses a session whose snowball game has already settled the pot',
            v_raised and v_msg like 'snowball_already_settled%',
            'raised=' || v_raised::text || ' message=' || coalesce(v_msg, 'none'));
end $$;

do $$
declare v_log public.session_reset_log; v_winners int;
begin
  -- Remove the settlement claim so the reset is allowed, and prove it records.
  delete from public.snowball_pot_history
   where game_id = '88888888-8888-4888-8888-888888888888';

  select count(*) into v_winners from public.winners
   where session_id = '55555555-5555-4555-8555-555555555555';

  v_log := public.reset_session_safe('55555555-5555-4555-8555-555555555555');

  perform t('reset :: records how many winners it destroyed',
            v_log.winners_deleted = v_winners,
            'log says ' || v_log.winners_deleted || ', there were ' || v_winners);

  perform t('reset :: keeps the destroyed winners as a snapshot',
            v_log.winners_snapshot is not null
              and jsonb_array_length(v_log.winners_snapshot) = v_winners,
            'the snapshot is the only record of a wiped night');

  perform t('reset :: actually deletes the winners',
            (select count(*) = 0 from public.winners
              where session_id = '55555555-5555-4555-8555-555555555555'),
            'winners survived the reset');

  perform t('reset :: puts the session back to ready',
            (select status = 'ready' from public.sessions
              where id = '55555555-5555-4555-8555-555555555555'),
            'session status after reset');
end $$;

-- ===========================================================================
-- The direct route into winners is closed
-- ===========================================================================
do $$
begin
  perform t('winners :: there is no INSERT policy, so PostgREST refuses a direct insert',
            not exists (select 1 from pg_policies
                         where schemaname = 'public' and tablename = 'winners' and cmd = 'INSERT'),
            'a role-only INSERT policy let a host fabricate a jackpot and force a pot reset');
end $$;
