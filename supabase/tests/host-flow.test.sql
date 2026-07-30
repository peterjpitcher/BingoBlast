-- Behavioural assertions for 20260730070705_revoke_anon_execute_on_host_rpcs.sql.
--
-- Run against a throwaway database via supabase/tests/run.sh, never against a
-- real project: it calls and voices numbers and inserts winners rows freely.
--
-- Grant assertions prove the catalogue is right. These prove the catalogue
-- change means what it should:
--   * the host flow still works end to end as the authenticated role, which is
--     the role the cookie-based Supabase client actually uses;
--   * anon is now stopped at the privilege layer with 42501, one step earlier
--     than the 'unauthorized: host or admin role required' that assert_is_host()
--     was raising on its own before.
--
-- The second point is the whole value of the migration. The old behaviour was
-- already safe, but it depended on auth.uid() being null for anon. Now the call
-- never reaches the function body at all.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- The blocks below run under "set role", so the roles need to be able to write
-- their own results. Harness-only, and nothing like this exists in production.
grant select, insert on table test_results to authenticated, anon;
grant usage, select on sequence test_results_seq_seq to authenticated, anon;
grant execute on function t(text, boolean, text) to authenticated, anon;

-- The authenticated blocks read a before-count to compare against, and the
-- harness grants no table privileges at all. Production is more permissive than
-- this, not less: Supabase's default privileges give authenticated full table
-- access in schema public and lean on RLS to scope it. SELECT to authenticated
-- only, so nothing here quietly widens what anon can reach.
grant select on table public.game_states, public.winners to authenticated;

\set host '11111111-1111-4111-8111-111111111111'
\set sess '55555555-5555-4555-8555-555555555555'
\set game '66666666-6666-4666-8666-666666666666'

-- ---------------------------------------------------------------------------
-- As authenticated: the real host path. auth.uid() comes from the test.uid GUC
-- that harness-schema.sql stubs it onto, standing in for the JWT claim.
-- ---------------------------------------------------------------------------
set test.uid = :'host';
set role authenticated;

do $$
declare
  v_state public.game_states;
  v_before int;
  v_err text;
begin
  select numbers_called_count into v_before
    from public.game_states where game_id = '66666666-6666-4666-8666-666666666666';

  begin
    -- p_min_gap_ms = 0 so the anti-double-tap window cannot make this flaky.
    v_state := public.call_next_number('66666666-6666-4666-8666-666666666666'::uuid, 0);
    perform t('host flow :: authenticated can call_next_number',
              v_state.numbers_called_count = v_before + 1,
              'count ' || v_before || ' -> ' || v_state.numbers_called_count);
  exception when others then
    v_err := sqlerrm;
    perform t('host flow :: authenticated can call_next_number', false,
              'SQLSTATE ' || sqlstate || ': ' || v_err);
  end;
end
$$;

do $$
declare
  v_state public.game_states;
  v_before int;
begin
  select numbers_called_count into v_before
    from public.game_states where game_id = '66666666-6666-4666-8666-666666666666';

  begin
    v_state := public.void_last_number('66666666-6666-4666-8666-666666666666'::uuid);
    perform t('host flow :: authenticated can void_last_number',
              v_state.numbers_called_count = v_before - 1,
              'count ' || v_before || ' -> ' || v_state.numbers_called_count);
  exception when others then
    perform t('host flow :: authenticated can void_last_number', false,
              'SQLSTATE ' || sqlstate || ': ' || sqlerrm);
  end;
end
$$;

do $$
declare
  v_state public.game_states;
  v_winners_before int;
  v_winners_after int;
begin
  select count(*) into v_winners_before
    from public.winners where game_id = '66666666-6666-4666-8666-666666666666';

  begin
    -- Seven named arguments, so this resolves to the real function and not to
    -- the eight-argument stub grants-drift.sql left behind.
    v_state := public.record_winner_atomic(
      p_session_id => '55555555-5555-4555-8555-555555555555'::uuid,
      p_game_id => '66666666-6666-4666-8666-666666666666'::uuid,
      p_stage => 'Line'::public.win_stage,
      p_prize_description => 'Line prize',
      p_prize_given => false,
      p_force_snowball_jackpot => false,
      p_snowball_eligible => false);

    select count(*) into v_winners_after
      from public.winners where game_id = '66666666-6666-4666-8666-666666666666';

    perform t('host flow :: authenticated can record_winner_atomic',
              v_winners_after = v_winners_before + 1
                and v_state.paused_for_validation
                and v_state.display_win_type = 'line',
              'winners ' || v_winners_before || ' -> ' || v_winners_after
                || ' paused=' || v_state.paused_for_validation
                || ' win_type=' || coalesce(v_state.display_win_type, 'null'));
  exception when others then
    perform t('host flow :: authenticated can record_winner_atomic', false,
              'SQLSTATE ' || sqlstate || ': ' || sqlerrm);
  end;
end
$$;

-- assert_is_host itself, called directly, must still succeed for a real host.
do $$
begin
  begin
    perform public.assert_is_host();
    perform t('host flow :: authenticated can assert_is_host', true, 'returned without raising');
  exception when others then
    perform t('host flow :: authenticated can assert_is_host', false,
              'SQLSTATE ' || sqlstate || ': ' || sqlerrm);
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- As anon: every one of the four must now fail with 42501 insufficient_privilege
-- BEFORE the function body runs. A 'unauthorized: host or admin role required'
-- here would mean the grant is still in place and assert_is_host() is once again
-- the only thing standing in the way, which is the state this migration exists
-- to end.
--
-- test.uid is deliberately left set to a genuine host id. If the revoke had not
-- worked, these calls would sail past assert_is_host() and mutate the game, so
-- the assertions cannot pass for the accidental reason that anon has no JWT.
-- ---------------------------------------------------------------------------
set role anon;

do $$
declare
  r record;
  v_sqlstate text;
  v_message text;
begin
  for r in
    select * from (values
      ('assert_is_host',       'select public.assert_is_host()'),
      ('call_next_number',     'select public.call_next_number(''66666666-6666-4666-8666-666666666666''::uuid, 0)'),
      ('void_last_number',     'select public.void_last_number(''66666666-6666-4666-8666-666666666666''::uuid)'),
      ('record_winner_atomic', 'select public.record_winner_atomic('
                               || '''55555555-5555-4555-8555-555555555555''::uuid, '
                               || '''66666666-6666-4666-8666-666666666666''::uuid, '
                               || '''Line''::public.win_stage, null, false, false, false)')
    ) as v(fname, stmt)
  loop
    v_sqlstate := null;
    v_message := null;
    begin
      execute r.stmt;
    exception when others then
      v_sqlstate := sqlstate;
      v_message := sqlerrm;
    end;

    perform t('host flow :: anon is refused by privilege on ' || r.fname,
              v_sqlstate = '42501',
              'SQLSTATE ' || coalesce(v_sqlstate, 'none, the call SUCCEEDED')
                || ': ' || coalesce(v_message, 'no error raised'));
  end loop;
end
$$;

reset role;
reset test.uid;
