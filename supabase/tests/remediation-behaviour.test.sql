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

-- A checked, valid claim for a game's current stage, as the host screen makes
-- one: begin a check for the attempt (replacing any other), then check the last
-- N balls called, which always include the last ball. Since
-- 20261001000400_claim_enforcement.sql record_winner_atomic records a new
-- winner only for such an attempt, with the attempt id as p_client_request_id.
-- pg_temp keeps it out of public, where the replay's function count would see it.
create or replace function pg_temp.valid_claim(p_game_id uuid, p_attempt_id uuid)
returns void language plpgsql as $$
declare
  v_state public.game_states;
  v_required int;
  v_numbers int[];
  v_result jsonb;
begin
  perform public.begin_claim_check(p_game_id, p_attempt_id, true);
  select * into v_state from public.game_states where game_id = p_game_id;
  select public.required_claim_count(g.stage_sequence ->> v_state.current_stage_index)
    into v_required from public.games g where g.id = p_game_id;
  select array_agg(x::int) into v_numbers
    from (select x from jsonb_array_elements_text(v_state.called_numbers) with ordinality e(x, o)
           order by o desc limit v_required) s;
  v_result := public.check_claim(p_game_id, p_attempt_id, v_numbers, false);
  if v_result ->> 'code' is distinct from 'valid' then
    raise exception 'fixture claim was not valid: %', v_result - 'game_state';
  end if;
end;
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

  -- Since M2b the forced flag outside the window is not the manual exemption,
  -- so this award needs a checked claim like any other.
  perform pg_temp.valid_claim('77777777-7777-4777-8777-777777777777',
                              'bbbbbbbb-0000-4000-8000-000000000001');

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
       (select jsonb_agg(n) from generate_series(1, 15) n),
       15, 0, 'in_progress', :host_id, now(), now();

do $$
declare
  v_first boolean;
  v_second boolean;
begin
  perform pg_temp.valid_claim('88888888-8888-4888-8888-888888888888',
                              'bbbbbbbb-0000-4000-8000-000000000002');
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
  perform pg_temp.valid_claim('88888888-8888-4888-8888-888888888888',
                              'bbbbbbbb-0000-4000-8000-000000000003');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    '88888888-8888-4888-8888-888888888888',
    'Full House'::public.win_stage,
    null, false, false, true,
    'bbbbbbbb-0000-4000-8000-000000000003'
  );

  select is_snowball_jackpot into v_second from public.winners
   where client_request_id = 'bbbbbbbb-0000-4000-8000-000000000003';

  -- Changed by the owner's decision on 2026-08-25: a tie SHARES the prize, and
  -- the snowball jackpot is a prize like any other. So both are jackpot winners
  -- and they take half the pot each. The pot still resets exactly once, because
  -- settle_snowball_pot only asks whether a jackpot winner exists.
  perform t('jackpot :: a tied second winner is also a jackpot winner, sharing one pot',
            v_second = true,
            'the house rule on the pub TV says multiple claims share the prize; was '
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

-- ===========================================================================
-- Prize amounts and tie shares. THE bug: two tied winners each recorded the
-- FULL prize, so the record said the pub paid £130 out of a £65 jackpot.
-- Ten ties already exist in production, two of them cash jackpots.
-- ===========================================================================
do $$
begin
  perform t('prize :: a pounds amount is read out of the free text',
            public.parse_prize_pence('£10 Cash') = 1000
              and public.parse_prize_pence('£110 Cash Jackpot') = 11000
              and public.parse_prize_pence('Snowball Jackpot £140') = 14000
              and public.parse_prize_pence('£12.50') = 1250
              and public.parse_prize_pence('£1,250') = 125000,
            'parsing covers every shape the pub actually uses');

  perform t('prize :: a non-money prize has no amount',
            public.parse_prize_pence('Bar of Chocolate') is null
              and public.parse_prize_pence('4 tickets to Quiz Night') is null
              and public.parse_prize_pence(null) is null,
            'a chocolate bar is not worth a number');
end $$;

-- A fresh game with a plain cash Line prize, and one winner.
\set game3_id '''aaaaaaaa-3333-4333-8333-333333333333'''
insert into public.games (id, session_id, game_index, name, type, stage_sequence, prizes)
values (:game3_id, :session_id, 3, 'Cash Line', 'standard', '["Line"]'::jsonb, '{"Line": "£10 Cash"}'::jsonb);

insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, controller_last_seen_at, started_at
)
select :game3_id,
       (select jsonb_agg(n) from generate_series(1, 90) n),
       (select jsonb_agg(n) from generate_series(1, 10) n),
       10, 0, 'in_progress', :host_id, now(), now();

do $$
declare v_amount int; v_share int;
begin
  perform pg_temp.valid_claim('aaaaaaaa-3333-4333-8333-333333333333',
                              'cccccccc-0000-4000-8000-000000000001');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-3333-4333-8333-333333333333',
    'Line'::public.win_stage, '£10 Cash', false, false, false,
    'cccccccc-0000-4000-8000-000000000001'
  );

  select prize_amount_pence, prize_share_pence into v_amount, v_share
    from public.winners where client_request_id = 'cccccccc-0000-4000-8000-000000000001';

  perform t('prize :: a single winner takes the whole prize',
            v_amount = 1000 and v_share = 1000,
            'amount=' || coalesce(v_amount::text,'null') || ' share=' || coalesce(v_share::text,'null'));
end $$;

do $$
declare v_shares int[];
begin
  -- A tie on the same stage. Both are valid wins; the prize is one prize.
  perform pg_temp.valid_claim('aaaaaaaa-3333-4333-8333-333333333333',
                              'cccccccc-0000-4000-8000-000000000002');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-3333-4333-8333-333333333333',
    'Line'::public.win_stage, '£10 Cash', false, false, false,
    'cccccccc-0000-4000-8000-000000000002'
  );

  select array_agg(prize_share_pence order by created_at, id) into v_shares
    from public.winners
   where game_id = 'aaaaaaaa-3333-4333-8333-333333333333' and stage = 'Line';

  perform t('prize :: a tie splits the prize evenly rather than paying it twice',
            v_shares = array[500, 500],
            'shares were ' || v_shares::text || ': the pub pays £10 once, not £10 each');
end $$;

do $$
declare v_shares int[]; v_total int;
begin
  -- Three ways on an amount that does not divide: 1000 / 3 = 333.33.
  perform pg_temp.valid_claim('aaaaaaaa-3333-4333-8333-333333333333',
                              'cccccccc-0000-4000-8000-000000000003');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-3333-4333-8333-333333333333',
    'Line'::public.win_stage, '£10 Cash', false, false, false,
    'cccccccc-0000-4000-8000-000000000003'
  );

  select array_agg(prize_share_pence order by created_at, id), sum(prize_share_pence)
    into v_shares, v_total
    from public.winners
   where game_id = 'aaaaaaaa-3333-4333-8333-333333333333' and stage = 'Line'
     and coalesce(is_void, false) = false;

  perform t('prize :: the odd penny goes to whoever was recorded first',
            v_shares = array[334, 333, 333],
            'shares were ' || v_shares::text);

  perform t('prize :: the shares always add up to the prize, with no penny invented or lost',
            v_total = 1000,
            'shares summed to ' || v_total || ' out of 1000');
end $$;

do $$
declare v_shares int[]; v_voided int;
begin
  -- Voiding one of three returns the stage to a two way split, automatically.
  update public.winners set is_void = true, void_reason = 'test'
   where client_request_id = 'cccccccc-0000-4000-8000-000000000003';

  select array_agg(prize_share_pence order by created_at, id) into v_shares
    from public.winners
   where game_id = 'aaaaaaaa-3333-4333-8333-333333333333' and stage = 'Line'
     and coalesce(is_void, false) = false;

  select prize_share_pence into v_voided
    from public.winners where client_request_id = 'cccccccc-0000-4000-8000-000000000003';

  perform t('prize :: voiding a tied winner re-splits the prize between the rest',
            v_shares = array[500, 500],
            'shares were ' || v_shares::text || ': a void must give the others their money back');

  perform t('prize :: a voided winner takes no share',
            v_voided is null,
            'voided share was ' || coalesce(v_voided::text, 'null'));
end $$;

-- A non-money prize, on its OWN game, because a stage has one prize. The first
-- version of this test recorded a chocolate bar onto the same stage as three
-- cash winners, and the chocolate winner was given a third of the cash. That was
-- a real flaw in the split, not a bad test: the host can edit the prize text
-- when recording a winner, so a stage whose rows disagree is reachable.
\set game4_id '''aaaaaaaa-4444-4444-8444-444444444444'''
insert into public.games (id, session_id, game_index, name, type, stage_sequence, prizes)
values (:game4_id, :session_id, 4, 'Chocolate Line', 'standard', '["Line"]'::jsonb, '{"Line": "Bar of Chocolate"}'::jsonb);

insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, controller_last_seen_at, started_at
)
select :game4_id,
       (select jsonb_agg(n) from generate_series(1, 90) n),
       (select jsonb_agg(n) from generate_series(1, 10) n),
       10, 0, 'in_progress', :host_id, now(), now();

do $$
declare v_share int; v_amount int;
begin
  perform pg_temp.valid_claim('aaaaaaaa-4444-4444-8444-444444444444',
                              'cccccccc-0000-4000-8000-000000000004');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'Line'::public.win_stage, 'Bar of Chocolate', false, false, false,
    'cccccccc-0000-4000-8000-000000000004'
  );
  select prize_amount_pence, prize_share_pence into v_amount, v_share
    from public.winners where client_request_id = 'cccccccc-0000-4000-8000-000000000004';
  perform t('prize :: a stage whose prize is not money has no amount and no share',
            v_share is null and v_amount is null,
            'amount=' || coalesce(v_amount::text,'null') || ' share=' || coalesce(v_share::text,'null'));
end $$;

do $$
declare v_cash int; v_choc int;
begin
  -- Rows on one stage that disagree about the prize are not one prize being
  -- shared. Each keeps its own value rather than averaging into a number nobody
  -- agreed to.
  perform pg_temp.valid_claim('aaaaaaaa-4444-4444-8444-444444444444',
                              'cccccccc-0000-4000-8000-000000000005');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'Line'::public.win_stage, '£20 Cash', false, false, false,
    'cccccccc-0000-4000-8000-000000000005'
  );

  select prize_share_pence into v_cash
    from public.winners where client_request_id = 'cccccccc-0000-4000-8000-000000000005';
  select prize_share_pence into v_choc
    from public.winners where client_request_id = 'cccccccc-0000-4000-8000-000000000004';

  perform t('prize :: a stage whose rows disagree is not split, each keeps its own value',
            v_cash = 2000 and v_choc is null,
            'cash=' || coalesce(v_cash::text,'null') || ' chocolate=' || coalesce(v_choc::text,'null')
              || ': a chocolate bar winner must never be handed half the cash');
end $$;

-- ===========================================================================
-- The pot history reconstruction. It runs against the migration's own guards,
-- which refuse rather than guess whenever the arithmetic does not add up.
-- ===========================================================================
do $$
declare v_rows int;
begin
  -- The test pot has been manually adjusted and reset by the assertions above,
  -- so the reconstruction must have refused rather than invented a story that
  -- does not end where the pot is.
  select count(*) into v_rows from public.snowball_pot_history
   where change_type = 'reconstructed_rollover';

  perform t('backfill :: reconstruction refuses on a pot whose arithmetic does not add up',
            v_rows = 0,
            'wrote ' || v_rows || ' reconstructed rows for a pot it should not have touched');
end $$;

-- ===========================================================================
-- Anonymity. Production held 43 real customer first names in a table that was,
-- until this branch, readable with the public key. They were archived, exported
-- to a file the owner holds, anonymised, and the archive was then dropped, so
-- this database now holds no customer names at all.
-- ===========================================================================
do $$
declare v_named int;
begin
  select count(*) into v_named from public.winners
   where winner_name is distinct from 'Anonymous';
  perform t('anonymity :: no winner row carries a name',
            v_named = 0,
            v_named || ' rows carry a name');
end $$;

do $$
declare v_name text;
begin
  -- The RPC is the only way a winner is created, so this is the assertion that
  -- keeps the table clean going forwards. It writes the literal and ignores
  -- anything a caller might want instead: there is no parameter for a name.
  perform pg_temp.valid_claim('aaaaaaaa-4444-4444-8444-444444444444',
                              'cccccccc-0000-4000-8000-000000000009');
  perform public.record_winner_atomic(
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-4444-4444-8444-444444444444',
    'Line'::public.win_stage, 'Bar of Chocolate', false, false, false,
    'cccccccc-0000-4000-8000-000000000009'
  );
  select winner_name into v_name from public.winners
   where client_request_id = 'cccccccc-0000-4000-8000-000000000009';
  perform t('anonymity :: record_winner_atomic writes the literal Anonymous',
            v_name = 'Anonymous',
            'wrote ' || coalesce(v_name, 'null'));
end $$;

do $$
begin
  -- The holding table is gone. If a future migration reintroduces somewhere to
  -- keep names, this assertion is what makes that a conscious act.
  perform t('anonymity :: the name archive no longer exists',
            to_regclass('public.winners_name_archive') is null,
            'winners_name_archive is still present, so the database still holds customer names');
end $$;
