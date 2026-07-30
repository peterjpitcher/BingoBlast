-- Assertions for 20260730064309_winner_idempotency_key.sql.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project: it writes and deletes winners rows freely.
--
-- What it is proving, in one line: a retried record-winner call must insert
-- nothing and return state, while a genuine tie must still save two rows.
--
-- Every assertion lands in test_results; the last query prints them and the
-- overall verdict.
create table if not exists test_results (seq serial, name text, ok boolean, detail text);
truncate test_results restart identity;

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- Constants for readability.
\set host '''11111111-1111-4111-8111-111111111111'''
\set rival '''22222222-2222-4222-8222-222222222222'''
\set sess '''55555555-5555-4555-8555-555555555555'''
\set g1 '''66666666-6666-4666-8666-666666666666'''
\set g2 '''77777777-7777-4777-8777-777777777777'''
\set snowsess '''88888888-8888-4888-8888-888888888888'''
\set snowgame '''99999999-9999-4999-8999-999999999999'''

set test.uid = '11111111-1111-4111-8111-111111111111';

-- T1: exactly one record_winner_atomic, so 7 named arguments cannot be ambiguous.
select t('T1 single function signature (no leftover 7-arg overload)',
         count(*) = 1,
         'signatures: ' || coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ' | '), 'none'))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_winner_atomic';

-- T15: the migration left the two rows that predate it alone. No backfill, no
-- collision between their nulls.
select t('T15 pre-existing winners rows keep a null key',
         count(*) = 2 and count(*) filter (where client_request_id is null) = 2,
         'rows=' || count(*) || ' null_keys=' || count(*) filter (where client_request_id is null))
  from public.winners;

-- From here on the counts are per-game, so clear the history fixtures.
delete from public.winners;

-- ---------------------------------------------------------------------------
-- T2: an app build that predates this migration sends 7 named arguments. It must
-- still resolve, and behave as before (no key, no protection).
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean := true; v_err text;
begin
  begin
    perform record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '66666666-6666-4666-8666-666666666666',
      p_stage => 'Line',
      p_prize_description => 'Line prize',
      p_prize_given => false,
      p_force_snowball_jackpot => false,
      p_snowball_eligible => false);
  exception when others then
    v_ok := false; v_err := sqlerrm;
  end;
  perform t('T2 seven named args (pre-migration app build) still resolve', v_ok, v_err);
end $$;

select t('T2b that call wrote one keyless row',
         count(*) = 1 and count(*) filter (where client_request_id is null) = 1,
         'rows=' || count(*))
  from public.winners where game_id = '66666666-6666-4666-8666-666666666666';

-- T6: two keyless calls are still unprotected. Documented, not a regression.
do $$
begin
  perform record_winner_atomic(
    p_session_id => '55555555-5555-4555-8555-555555555555',
    p_game_id => '66666666-6666-4666-8666-666666666666',
    p_stage => 'Line', p_prize_description => 'Line prize');
end $$;

select t('T6 null key gives no protection (documented, unchanged behaviour)',
         count(*) = 2, 'rows=' || count(*))
  from public.winners where game_id = '66666666-6666-4666-8666-666666666666';

delete from public.winners;

-- ---------------------------------------------------------------------------
-- T3/T4: the fix. One tap, then the retry of the same tap.
-- ---------------------------------------------------------------------------
do $$
declare
  k1 uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
  v1 public.game_states;
  v2 public.game_states;
begin
  v1 := record_winner_atomic(
    p_session_id => '55555555-5555-4555-8555-555555555555',
    p_game_id => '66666666-6666-4666-8666-666666666666',
    p_stage => 'Line', p_prize_description => 'Line prize',
    p_client_request_id => k1);

  perform t('T3 first attempt records the winner',
    (select count(*) from public.winners
      where game_id = '66666666-6666-4666-8666-666666666666') = 1);

  perform t('T3b first attempt pauses for validation and sets the display',
    v1.paused_for_validation and v1.display_win_type = 'line' and v1.display_win_text = 'BINGO!',
    'paused=' || v1.paused_for_validation || ' type=' || v1.display_win_type);

  perform t('T3c the key is stored on the row',
    (select client_request_id from public.winners
      where game_id = '66666666-6666-4666-8666-666666666666') = k1);

  -- The lost-response retry.
  v2 := record_winner_atomic(
    p_session_id => '55555555-5555-4555-8555-555555555555',
    p_game_id => '66666666-6666-4666-8666-666666666666',
    p_stage => 'Line', p_prize_description => 'Line prize',
    p_client_request_id => k1);

  perform t('T4 retry with the same key inserts nothing',
    (select count(*) from public.winners
      where game_id = '66666666-6666-4666-8666-666666666666') = 1,
    'rows=' || (select count(*) from public.winners
      where game_id = '66666666-6666-4666-8666-666666666666'));

  perform t('T4b retry returns state rather than raising, and writes nothing '
            || '(state_version unchanged)',
    v2.state_version = v1.state_version,
    'first=' || v1.state_version || ' retry=' || v2.state_version);

  perform t('T4c retry returns the same display state the first attempt set',
    v2.paused_for_validation and v2.display_win_type = 'line'
      and v2.display_win_text = 'BINGO!');
end $$;

-- ---------------------------------------------------------------------------
-- T5: a genuine tie. Different claim, different key, same stage and same ball.
-- ---------------------------------------------------------------------------
do $$
declare k2 uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddd002';
begin
  perform record_winner_atomic(
    p_session_id => '55555555-5555-4555-8555-555555555555',
    p_game_id => '66666666-6666-4666-8666-666666666666',
    p_stage => 'Line', p_prize_description => 'Line prize',
    p_client_request_id => k2);
end $$;

select t('T5 genuine tie: two different keys both save on the same stage/ball',
         count(*) = 2
           and count(distinct client_request_id) = 2
           and count(distinct stage) = 1
           and count(distinct call_count_at_win) = 1,
         'rows=' || count(*) || ' keys=' || count(distinct client_request_id)
           || ' stages=' || count(distinct stage)
           || ' call_counts=' || count(distinct call_count_at_win))
  from public.winners where game_id = '66666666-6666-4666-8666-666666666666';

-- ---------------------------------------------------------------------------
-- T7: the same key presented against a different game is a client bug.
-- ---------------------------------------------------------------------------
do $$
declare v_err text := 'no error raised';
begin
  begin
    perform record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '77777777-7777-4777-8777-777777777777',
      p_stage => 'Line',
      p_client_request_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddd001');
  exception when others then v_err := sqlerrm;
  end;
  perform t('T7 key reused against a different game raises request_id_reused',
    v_err = 'request_id_reused', 'got: ' || v_err);
  perform t('T7b and writes nothing to that other game',
    (select count(*) from public.winners
      where game_id = '77777777-7777-4777-8777-777777777777') = 0);
end $$;

-- ---------------------------------------------------------------------------
-- T8/T9: a retry that arrives late. The state has moved on. It must still be a
-- no-op, not a stage_mismatch or not_controller error.
-- ---------------------------------------------------------------------------
update public.game_states set current_stage_index = 1
 where game_id = '66666666-6666-4666-8666-666666666666';

do $$
declare v_err text := 'no error'; v_state public.game_states;
begin
  begin
    v_state := record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '66666666-6666-4666-8666-666666666666',
      p_stage => 'Line',
      p_client_request_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddd001');
  exception when others then v_err := sqlerrm;
  end;
  perform t('T8 late retry after the stage advanced is still a no-op',
    v_err = 'no error' and v_state.current_stage_index = 1, 'got: ' || v_err);
end $$;

update public.game_states
   set controlling_host_id = '22222222-2222-4222-8222-222222222222'
 where game_id = '66666666-6666-4666-8666-666666666666';

do $$
declare v_err text := 'no error';
begin
  begin
    perform record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '66666666-6666-4666-8666-666666666666',
      p_stage => 'Line',
      p_client_request_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddd001');
  exception when others then v_err := sqlerrm;
  end;
  perform t('T9 late retry after another host took control is still a no-op',
    v_err = 'no error', 'got: ' || v_err);
end $$;

-- T16: but the prechecks must still bite for a genuinely NEW claim.
do $$
declare v_err text := 'no error';
begin
  begin
    perform record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '66666666-6666-4666-8666-666666666666',
      p_stage => 'Line',
      p_client_request_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddd003');
  exception when others then v_err := sqlerrm;
  end;
  perform t('T16 a new key is still refused by the controller precheck',
    v_err = 'not_controller', 'got: ' || v_err);
end $$;

update public.game_states
   set controlling_host_id = '11111111-1111-4111-8111-111111111111',
       current_stage_index = 0
 where game_id = '66666666-6666-4666-8666-666666666666';

do $$
declare v_err text := 'no error';
begin
  begin
    perform record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '66666666-6666-4666-8666-666666666666',
      p_stage => 'Full House',
      p_client_request_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddd004');
  exception when others then v_err := sqlerrm;
  end;
  perform t('T16b a new key is still refused by the stage precheck',
    v_err = 'stage_mismatch', 'got: ' || v_err);
end $$;

-- T14: a retry after the recorded win was voided is still the same attempt.
update public.winners set is_void = true, void_reason = 'test'
 where client_request_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';

do $$
declare v_err text := 'no error';
begin
  begin
    perform record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555',
      p_game_id => '66666666-6666-4666-8666-666666666666',
      p_stage => 'Line',
      p_client_request_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddd001');
  exception when others then v_err := sqlerrm;
  end;
  perform t('T14 retry after that win was voided is still a no-op', v_err = 'no error',
    'got: ' || v_err);
  perform t('T14b and does not resurrect a second row',
    (select count(*) from public.winners
      where client_request_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001') = 1);
end $$;

-- ---------------------------------------------------------------------------
-- T10: the money case. Snowball Full House, jackpot window open, retried.
-- ---------------------------------------------------------------------------
do $$
declare
  k uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddd010';
  v1 public.game_states;
  v2 public.game_states;
begin
  v1 := record_winner_atomic(
    p_session_id => '88888888-8888-4888-8888-888888888888',
    p_game_id => '99999999-9999-4999-8999-999999999999',
    p_stage => 'Full House', p_prize_description => 'House prize',
    p_snowball_eligible => true, p_client_request_id => k);

  v2 := record_winner_atomic(
    p_session_id => '88888888-8888-4888-8888-888888888888',
    p_game_id => '99999999-9999-4999-8999-999999999999',
    p_stage => 'Full House', p_prize_description => 'House prize',
    p_snowball_eligible => true, p_client_request_id => k);

  perform t('T10 snowball jackpot retry leaves exactly one jackpot row',
    (select count(*) from public.winners
      where game_id = '99999999-9999-4999-8999-999999999999'
        and is_snowball_jackpot) = 1,
    'jackpot_rows=' || (select count(*) from public.winners
      where game_id = '99999999-9999-4999-8999-999999999999'
        and is_snowball_jackpot));

  perform t('T10b the cash amount appears once, on one row only',
    (select array_agg(prize_description) from public.winners
      where game_id = '99999999-9999-4999-8999-999999999999')
      = array['House prize + Snowball Jackpot £240'],
    'prizes=' || (select array_agg(prize_description)::text from public.winners
      where game_id = '99999999-9999-4999-8999-999999999999'));

  perform t('T10c the jackpot celebration text is preserved on the retry',
    v2.display_win_text = v1.display_win_text
      and v2.display_win_text = 'FULL HOUSE + SNOWBALL £240!',
    'text=' || coalesce(v2.display_win_text, 'null'));
end $$;

-- ---------------------------------------------------------------------------
-- T11/T12: the exception handler's assumption. A partial unique INDEX (not a
-- constraint) must still report its name in the CONSTRAINT_NAME diagnostic, and
-- any other unique violation must fall through to "raise".
-- ---------------------------------------------------------------------------
create or replace function probe_constraint(p_id uuid, p_key uuid)
returns text language plpgsql as $$
declare v text;
begin
  insert into public.winners (id, session_id, game_id, stage, winner_name, client_request_id)
  values (p_id, '55555555-5555-4555-8555-555555555555',
          '66666666-6666-4666-8666-666666666666', 'Line', 'Anonymous', p_key);
  return 'inserted';
exception when unique_violation then
  get stacked diagnostics v = constraint_name;
  return v;
end;
$$;

select t('T11 a partial unique index reports its name in CONSTRAINT_NAME',
         probe_constraint(gen_random_uuid(), 'dddddddd-dddd-4ddd-8ddd-ddddddddd002')
           = 'winners_client_request_id_key',
         'got: ' || probe_constraint(gen_random_uuid(), 'dddddddd-dddd-4ddd-8ddd-ddddddddd002'));

select t('T12 a different unique violation reports a different name, so the '
         || 'handler re-raises it',
         probe_constraint(
           (select id from public.winners
             where client_request_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002'),
           gen_random_uuid()) = 'winners_pkey',
         'got: ' || probe_constraint(
           (select id from public.winners
             where client_request_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd002'),
           gen_random_uuid()));

-- ---------------------------------------------------------------------------
-- T13: grants on the new signature.
-- ---------------------------------------------------------------------------
select t('T13 execute revoked from PUBLIC, granted to authenticated and service_role',
         not has_function_privilege('public', p.oid, 'execute')
           and has_function_privilege('authenticated', p.oid, 'execute')
           and has_function_privilege('service_role', p.oid, 'execute'),
         'acl=' || coalesce(p.proacl::text, 'null'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_winner_atomic';

-- T17: the index is unique and partial, as intended.
select t('T17 index is UNIQUE and partial on client_request_id is not null',
         count(*) = 1,
         coalesce(string_agg(indexdef, ' | '), 'missing'))
  from pg_indexes
 where schemaname = 'public' and tablename = 'winners'
   and indexname = 'winners_client_request_id_key'
   and indexdef like 'CREATE UNIQUE INDEX%'
   and indexdef like '%WHERE (client_request_id IS NOT NULL)%';

\echo ''
\echo '================ RESULTS ================'
select seq, case when ok then 'PASS' else 'FAIL' end as result, name, detail
  from test_results order by seq;

select count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed,
       case when count(*) filter (where not ok) = 0 then 'ALL PASS' else 'FAILURES PRESENT' end as verdict
  from test_results;
