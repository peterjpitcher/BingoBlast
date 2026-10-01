-- Behavioural assertions for the claim migrations, run against the fully
-- replayed database in suites D and E of supabase/tests/run.sh:
--   M2a  20261001075215_claim_attempts.sql      begin_claim_check,
--        set_claim_draft, check_claim, guard_claim_fields, the bound undo and
--        the public mirror
--   M2b  20261001075456_claim_enforcement.sql   record_winner_atomic requiring
--        the checked attempt, the manual snowball exemption, the win text and
--        the money text
-- M2b sits on M3, so this is the final combined definition, as production will
-- run it.
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

create or replace function pg_temp.act_as(p_uid uuid) returns void
language sql as $$
  select set_config('request.jwt.claim.sub', p_uid::text, false);
$$;

create or replace function pg_temp.st(p_game_id uuid) returns public.game_states
language sql as $$
  select * from public.game_states where game_id = p_game_id;
$$;

create or replace function pg_temp.pub(p_game_id uuid) returns public.game_states_public
language sql as $$
  select * from public.game_states_public where game_id = p_game_id;
$$;

-- A checked, valid claim for the current stage: the last N balls called.
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
-- The stage counts. The SQL helper must equal REQUIRED_SELECTION_COUNT_BY_STAGE
-- in src/lib/win-stages.ts. The block between the two markers is that constant,
-- copied; supabase/tests/claim-stage-counts.test.ts (npm test) reads this block
-- and fails if it differs from win-stages.ts, and the assertion below fails if
-- the SQL helper differs from the block. Change all three together.
-- ---------------------------------------------------------------------------
select t('stage counts :: required_claim_count equals the constant copied from win-stages.ts',
         (select bool_and(public.required_claim_count(e.stage) = e.required)
            from (values
-- STAGE_COUNTS_BEGIN
                    ('Line', 5),
                    ('Two Lines', 10),
                    ('Full House', 15)
-- STAGE_COUNTS_END
                 ) as e(stage, required))
         and public.required_claim_count('Snowball') is null,
         (select string_agg(s || '=' || coalesce(public.required_claim_count(s)::text, 'null'), ', ')
            from unnest(array['Line', 'Two Lines', 'Full House', 'Snowball']) s));

-- ---------------------------------------------------------------------------
-- Fixtures, in their own uuid range.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-000000000001', 'cl-host@example.invalid'),
  ('d1000000-0000-4000-8000-000000000002', 'cl-rival@example.invalid'),
  ('d1000000-0000-4000-8000-000000000004', 'cl-pending@example.invalid');

update public.profiles set role = 'host'
 where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');

insert into public.snowball_pots (
  id, name, base_max_calls, base_jackpot_amount, calls_increment, jackpot_increment,
  current_max_calls, current_jackpot_amount
) values
  ('d6000000-0000-4000-8000-000000000001', 'Claims pot', 30, 20, 2, 20, 40, 212.50),
  ('d6000000-0000-4000-8000-000000000002', 'Claims big pot', 30, 20, 2, 20, 40, 1250.00);

insert into public.sessions (id, name, status, is_test_session) values
  ('d2000000-0000-4000-8000-000000000001', 'Claims night', 'running', false),
  ('d2000000-0000-4000-8000-000000000002', 'Rehearsal', 'running', true);

insert into public.games (id, session_id, game_index, name, type, stage_sequence, snowball_pot_id, prizes) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 1, 'Claims A', 'standard',
   '["Line", "Two Lines", "Full House"]', null, '{"Line": "£10 Cash", "Two Lines": "£20 Cash", "Full House": "£50 Cash"}'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 2, 'Claims B', 'standard',
   '["Line", "Two Lines", "Full House"]', null, '{"Line": "£10 Cash", "Two Lines": "£20 Cash", "Full House": "£50 Cash"}'),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 3, 'Snowball open', 'snowball',
   '["Full House"]', 'd6000000-0000-4000-8000-000000000001', '{"Full House": "£25 Cash"}'),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000001', 4, 'Snowball closed', 'snowball',
   '["Full House"]', 'd6000000-0000-4000-8000-000000000001', '{"Full House": "£25 Cash"}'),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000002', 1, 'Rehearsal snowball', 'snowball',
   '["Full House"]', 'd6000000-0000-4000-8000-000000000001', '{"Full House": "£25 Cash"}'),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000001', 5, 'Snowball big', 'snowball',
   '["Full House"]', 'd6000000-0000-4000-8000-000000000002', '{"Full House": "£25 Cash"}'),
  ('d3000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000001', 6, 'Not started', 'standard',
   '["Line"]', null, '{"Line": "£10 Cash"}'),
  ('d3000000-0000-4000-8000-000000000010', 'd2000000-0000-4000-8000-000000000001', 7, 'Insert probe', 'standard',
   '["Line"]', null, '{"Line": "£10 Cash"}');

-- A sorted bag, so the balls are 1, 2, 3 and so on.
insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, controller_last_seen_at, started_at, last_call_at
)
select g.id,
       (select jsonb_agg(n order by n) from generate_series(1, 90) n),
       (select jsonb_agg(n order by n) from generate_series(1, g.called) n),
       g.called, 0, g.status::public.game_status,
       'd1000000-0000-4000-8000-000000000001', now(), now(), now() - interval '5 seconds'
  from (values
          ('d3000000-0000-4000-8000-000000000001'::uuid, 12, 'in_progress'),
          ('d3000000-0000-4000-8000-000000000002'::uuid, 20, 'in_progress'),
          ('d3000000-0000-4000-8000-000000000003'::uuid, 20, 'in_progress'),
          ('d3000000-0000-4000-8000-000000000004'::uuid, 45, 'in_progress'),
          ('d3000000-0000-4000-8000-000000000005'::uuid, 20, 'in_progress'),
          ('d3000000-0000-4000-8000-000000000006'::uuid, 20, 'in_progress'),
          ('d3000000-0000-4000-8000-000000000009'::uuid, 0, 'not_started')
       ) as g(id, called, status);

select pg_temp.act_as('d1000000-0000-4000-8000-000000000001');

-- ===========================================================================
-- begin_claim_check: the refusals raised before any check exists
-- ===========================================================================
do $$
declare v text;
begin
  update public.game_states set on_break = true where game_id = 'd3000000-0000-4000-8000-000000000001';
  v := pg_temp.err($q$select public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')$q$);
  update public.game_states set on_break = false where game_id = 'd3000000-0000-4000-8000-000000000001';
  perform t('begin :: refused on a break', v = 'on_break', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.begin_claim_check('d3000000-0000-4000-8000-000000000001', null)$q$);
  perform t('begin :: refused without an attempt id', v = 'attempt_required', coalesce(v, 'no error'));

  perform pg_temp.act_as('d1000000-0000-4000-8000-000000000002');
  v := pg_temp.err($q$select public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')$q$);
  perform pg_temp.act_as('d1000000-0000-4000-8000-000000000001');
  perform t('begin :: refused for a host who is not the controller', v = 'not_controller', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.begin_claim_check('d3000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001')$q$);
  perform t('begin :: refused on a game not in progress', v = 'not_in_progress', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.begin_claim_check(gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001')$q$);
  perform t('begin :: refused on a game with no state', v = 'game_state_not_found', coalesce(v, 'no error'));

  perform t('begin :: none of the refusals paused the game',
            not (pg_temp.st('d3000000-0000-4000-8000-000000000001')).paused_for_validation,
            'the game is paused');
end $$;

-- ===========================================================================
-- begin_claim_check: start, a same-attempt retry, a different attempt
-- ===========================================================================
do $$
declare r jsonb; s public.game_states; p public.game_states_public; v_version bigint;
begin
  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
  s := pg_temp.st('d3000000-0000-4000-8000-000000000001');
  p := pg_temp.pub('d3000000-0000-4000-8000-000000000001');

  perform t('begin :: starts a check: pauses and stores the attempt and its snapshots',
            r ->> 'ok' = 'true' and r ->> 'code' = 'started'
              and s.paused_for_validation and s.claim_attempt_id = 'a0000000-0000-4000-8000-000000000001'
              and s.claim_stage_index = 0 and s.claim_call_count = 12 and s.claim_draft_seq = 0
              and not s.claim_undo_used and s.claim_numbers = '[]'::jsonb and s.claim_result is null,
            (r - 'game_state')::text);
  perform t('begin :: the public mirror shows the pause and an empty claim',
            p.paused_for_validation and p.claim_numbers = '[]'::jsonb and p.claim_result is null,
            'claim_numbers=' || coalesce(p.claim_numbers::text, 'null'));

  v_version := s.state_version;
  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
  perform t('begin :: the same attempt again is a no-op',
            r ->> 'ok' = 'true' and r ->> 'code' = 'already_started'
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).state_version = v_version,
            (r - 'game_state')::text);

  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
  perform t('begin :: a different attempt gets attempt_mismatch and the current attempt to adopt',
            r ->> 'ok' = 'false' and r ->> 'code' = 'attempt_mismatch'
              and r ->> 'attempt_id' = 'a0000000-0000-4000-8000-000000000001'
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_attempt_id = 'a0000000-0000-4000-8000-000000000001',
            (r - 'game_state')::text);
end $$;

-- ===========================================================================
-- set_claim_draft: live drafts, their order, and their refusals
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', array[3], 1);
  perform t('draft :: another attempt''s draft is refused with attempt_mismatch',
            r ->> 'ok' = 'false' and r ->> 'code' = 'attempt_mismatch', (r - 'game_state')::text);

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[3, 7], 1);
  perform t('draft :: a draft is stored and mirrored in tap order',
            r ->> 'code' = 'saved'
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_numbers = '[3, 7]'::jsonb
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_draft_seq = 1
              and (pg_temp.pub('d3000000-0000-4000-8000-000000000001')).claim_numbers = '[3, 7]'::jsonb,
            (r - 'game_state')::text);

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[3], 1);
  perform t('draft :: a sequence not above the stored one is ignored',
            r ->> 'ok' = 'true' and r ->> 'code' = 'stale_seq'
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_numbers = '[3, 7]'::jsonb,
            (r - 'game_state')::text);

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[7, 3, 9], 3);
  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[7, 3], 2);
  perform t('draft :: an out-of-order older draft arriving late is ignored',
            r ->> 'code' = 'stale_seq'
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_numbers = '[7, 3, 9]'::jsonb
              and (r ->> 'claim_draft_seq')::int = 3,
            (r - 'game_state')::text);

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[3, 3], 4);
  perform t('draft :: duplicates are refused', r ->> 'ok' = 'false' and r ->> 'code' = 'duplicate_numbers', r ->> 'code');

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[0, 5], 4);
  perform t('draft :: 0 is refused', r ->> 'code' = 'number_out_of_range', r ->> 'code');

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[91], 4);
  perform t('draft :: 91 is refused', r ->> 'code' = 'number_out_of_range', r ->> 'code');

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4, 5, 6], 4);
  perform t('draft :: more numbers than the stage needs are refused', r ->> 'code' = 'too_many_numbers', r ->> 'code');

  perform t('draft :: no refused draft changed the stored one',
            (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_numbers = '[7, 3, 9]'::jsonb
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_draft_seq = 3,
            (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_numbers::text);
end $$;

-- ===========================================================================
-- check_claim: refusals, the invalid verdict, retries
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4, 99]);
  perform t('check :: a number above 90 is refused', r ->> 'ok' = 'false' and r ->> 'code' = 'number_out_of_range', r ->> 'code');

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4]);
  perform t('check :: the wrong count for the stage is refused', r ->> 'code' = 'wrong_count', r ->> 'code');

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1, 1, 2, 3, 4]);
  perform t('check :: duplicates are refused', r ->> 'code' = 'duplicate_numbers', r ->> 'code');

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', array[1, 2, 3, 4, 12]);
  perform t('check :: another attempt is refused with attempt_mismatch', r ->> 'code' = 'attempt_mismatch', r ->> 'code');

  perform t('check :: no refusal wrote a verdict',
            (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_result is null, 'a verdict was written');

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4, 50]);
  perform t('check :: an uncalled number makes the claim invalid, and it is named',
            r ->> 'ok' = 'true' and r ->> 'code' = 'invalid' and r -> 'invalid_numbers' = '[50]'::jsonb
              and (r ->> 'last_number')::int = 12
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_result = 'invalid',
            (r - 'game_state')::text);
  perform t('check :: the public mirror shows the numbers and the invalid verdict',
            (pg_temp.pub('d3000000-0000-4000-8000-000000000001')).claim_result = 'invalid'
              and (pg_temp.pub('d3000000-0000-4000-8000-000000000001')).claim_numbers = '[1, 2, 3, 4, 50]'::jsonb,
            (pg_temp.pub('d3000000-0000-4000-8000-000000000001')).claim_numbers::text);
end $$;

do $$
declare r jsonb; v_version bigint;
begin
  v_version := (pg_temp.st('d3000000-0000-4000-8000-000000000001')).state_version;
  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[50, 4, 3, 2, 1]);
  perform t('check :: a retry with the same numbers returns the stored verdict and writes nothing',
            r ->> 'ok' = 'true' and r ->> 'code' = 'invalid' and r -> 'invalid_numbers' = '[50]'::jsonb
              and (pg_temp.st('d3000000-0000-4000-8000-000000000001')).state_version = v_version,
            (r - 'game_state')::text);

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4, 12]);
  perform t('check :: different numbers after a verdict are refused with verdict_already_given',
            r ->> 'ok' = 'false' and r ->> 'code' = 'verdict_already_given' and r ->> 'claim_result' = 'invalid',
            (r - 'game_state')::text);

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', array[1], 9);
  perform t('draft :: a draft after the verdict is refused', r ->> 'code' = 'verdict_already_given', r ->> 'code');
end $$;

-- ===========================================================================
-- guard_claim_fields: a direct forge is refused, other columns still write,
-- and the unpause clears the claim
-- ===========================================================================
do $$
declare v text;
begin
  v := pg_temp.err($q$update public.game_states set claim_result = 'valid' where game_id = 'd3000000-0000-4000-8000-000000000001'$q$);
  perform t('guard :: a direct update of claim_result is refused', v = 'claim_fields_protected', coalesce(v, 'no error'));

  v := pg_temp.err($q$update public.game_states set claim_numbers = '[1, 2, 3, 4, 12]' where game_id = 'd3000000-0000-4000-8000-000000000001'$q$);
  perform t('guard :: a direct update of claim_numbers is refused', v = 'claim_fields_protected', coalesce(v, 'no error'));

  v := pg_temp.err($q$update public.game_states set claim_attempt_id = gen_random_uuid() where game_id = 'd3000000-0000-4000-8000-000000000001'$q$);
  perform t('guard :: a direct update of the attempt is refused', v = 'claim_fields_protected', coalesce(v, 'no error'));

  v := pg_temp.err($q$update public.game_states set controller_last_seen_at = now() where game_id = 'd3000000-0000-4000-8000-000000000001'$q$);
  perform t('guard :: other columns still update directly while paused', v is null, coalesce(v, 'no error'));

  perform t('guard :: the refused forges changed nothing',
            (pg_temp.st('d3000000-0000-4000-8000-000000000001')).claim_result = 'invalid', 'claim_result changed');
end $$;

do $$
declare s public.game_states; p public.game_states_public;
begin
  update public.game_states set paused_for_validation = false where game_id = 'd3000000-0000-4000-8000-000000000001';
  s := pg_temp.st('d3000000-0000-4000-8000-000000000001');
  p := pg_temp.pub('d3000000-0000-4000-8000-000000000001');
  perform t('guard :: an unpause clears every claim field',
            s.claim_attempt_id is null and s.claim_stage_index is null and s.claim_call_count is null
              and s.claim_draft_seq = 0 and not s.claim_undo_used
              and s.claim_numbers is null and s.claim_result is null,
            'attempt=' || coalesce(s.claim_attempt_id::text, 'null') || ' result=' || coalesce(s.claim_result, 'null'));
  perform t('guard :: the unpause clears the public claim too',
            p.claim_numbers is null and p.claim_result is null and not p.paused_for_validation,
            coalesce(p.claim_numbers::text, 'null'));
end $$;

do $$
declare v text;
begin
  v := pg_temp.err($q$insert into public.game_states (game_id, status, paused_for_validation, claim_result, claim_numbers)
                      values ('d3000000-0000-4000-8000-000000000010', 'in_progress', true, 'valid', '[1, 2, 3, 4, 5]')$q$);
  perform t('guard :: inserting a paused state with a forged verdict is refused',
            v = 'claim_fields_protected', coalesce(v, 'no error'));

  insert into public.game_states (game_id, status, paused_for_validation, claim_result)
  values ('d3000000-0000-4000-8000-000000000010', 'not_started', false, 'valid');
  perform t('guard :: an unpaused insert has its claim fields cleared',
            (pg_temp.st('d3000000-0000-4000-8000-000000000010')).claim_result is null, 'claim_result kept');
  delete from public.game_states where game_id = 'd3000000-0000-4000-8000-000000000010';
end $$;

-- ===========================================================================
-- missing_last_ball, the bound undo, then valid
-- ===========================================================================
do $$
declare r jsonb; s public.game_states;
begin
  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', array[3, 8, 9, 10, 11]);
  s := pg_temp.st('d3000000-0000-4000-8000-000000000001');
  perform t('check :: every number called but not the last ball is missing_last_ball, with no verdict',
            r ->> 'ok' = 'true' and r ->> 'code' = 'missing_last_ball' and (r ->> 'last_number')::int = 12
              and s.claim_result is null and s.claim_numbers = '[3, 8, 9, 10, 11]'::jsonb,
            (r - 'game_state')::text);
end $$;

do $$
declare v text; s public.game_states;
begin
  v := pg_temp.err($q$select public.void_last_number('d3000000-0000-4000-8000-000000000001')$q$);
  perform t('undo :: an undo without the attempt is refused while paused',
            v = 'paused_for_validation', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.void_last_number('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 12)$q$);
  perform t('undo :: an undo for another attempt is refused', v = 'attempt_mismatch', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.void_last_number('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 11)$q$);
  perform t('undo :: an undo bound to a count the board is not at is refused', v = 'already_undone', coalesce(v, 'no error'));

  s := pg_temp.st('d3000000-0000-4000-8000-000000000001');
  perform t('undo :: the refusals removed no ball', s.numbers_called_count = 12, 'count=' || s.numbers_called_count);

  s := public.void_last_number('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 12);
  perform t('undo :: the bound undo removes the last ball and marks the attempt',
            s.numbers_called_count = 11 and jsonb_array_length(s.called_numbers) = 11
              and s.claim_undo_used and s.claim_call_count = 11 and s.paused_for_validation
              and s.claim_attempt_id = 'a0000000-0000-4000-8000-000000000003',
            'count=' || s.numbers_called_count || ' undo_used=' || s.claim_undo_used);

  v := pg_temp.err($q$select public.void_last_number('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 12)$q$);
  perform t('undo :: a repeated tap finds the count changed and refuses', v = 'already_undone', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.void_last_number('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 11)$q$);
  perform t('undo :: a second undo for the same attempt is refused', v = 'already_undone', coalesce(v, 'no error'));

  perform t('undo :: only the one ball came out',
            (pg_temp.st('d3000000-0000-4000-8000-000000000001')).numbers_called_count = 11,
            'count=' || (pg_temp.st('d3000000-0000-4000-8000-000000000001')).numbers_called_count);
end $$;

do $$
declare r jsonb; v text;
begin
  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', array[3, 8, 9, 10, 11]);
  perform t('check :: after the undo the same numbers are valid',
            r ->> 'code' = 'valid' and (pg_temp.pub('d3000000-0000-4000-8000-000000000001')).claim_result = 'valid',
            (r - 'game_state')::text);

  v := pg_temp.err($q$select public.void_last_number('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 11)$q$);
  perform t('undo :: no undo once a verdict is given', v = 'verdict_already_given', coalesce(v, 'no error'));
end $$;

-- ===========================================================================
-- p_new_claimant, late claims, a stale attempt
-- ===========================================================================
do $$
declare r jsonb; s public.game_states;
begin
  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', true);
  s := pg_temp.st('d3000000-0000-4000-8000-000000000001');
  perform t('begin :: p_new_claimant replaces the attempt and resets the claim',
            r ->> 'code' = 'replaced' and s.claim_attempt_id = 'a0000000-0000-4000-8000-000000000004'
              and s.claim_numbers = '[]'::jsonb and s.claim_result is null and s.claim_draft_seq = 0
              and not s.claim_undo_used and s.claim_call_count = 11,
            (r - 'game_state')::text);

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', array[1, 2, 3, 4, 5]);
  perform t('check :: missing the last ball again asks the host', r ->> 'code' = 'missing_last_ball', r ->> 'code');

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', array[1, 2, 3, 4, 5], true);
  perform t('check :: the host rejecting it as late gives the late verdict',
            r ->> 'code' = 'late' and (pg_temp.pub('d3000000-0000-4000-8000-000000000001')).claim_result = 'late',
            (r - 'game_state')::text);

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', array[5, 4, 3, 2, 1]);
  perform t('check :: a retry of a late verdict returns late', r ->> 'ok' = 'true' and r ->> 'code' = 'late', r ->> 'code');
end $$;

do $$
declare r jsonb;
begin
  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', true);
  update public.game_states set current_stage_index = 1 where game_id = 'd3000000-0000-4000-8000-000000000001';

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005',
                          array[2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  perform t('check :: a stage change since the check started makes the attempt stale',
            r ->> 'ok' = 'false' and r ->> 'code' = 'stale_attempt', r ->> 'code');

  r := public.set_claim_draft('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', array[2], 1);
  perform t('draft :: a stale attempt''s draft is refused', r ->> 'code' = 'stale_attempt', r ->> 'code');

  update public.game_states set current_stage_index = 0, paused_for_validation = false
   where game_id = 'd3000000-0000-4000-8000-000000000001';

  r := public.check_claim('d3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', array[1, 2, 3, 4, 11]);
  perform t('check :: a check once the game has resumed is refused with not_paused',
            r ->> 'ok' = 'false' and r ->> 'code' = 'not_paused', r ->> 'code');
end $$;

do $$
declare s public.game_states;
begin
  s := public.void_last_number('d3000000-0000-4000-8000-000000000001');
  perform t('undo :: unpaused, the one-argument undo works exactly as before',
            s.numbers_called_count = 10, 'count=' || s.numbers_called_count);
end $$;

-- ===========================================================================
-- record_winner_atomic under M2b
-- ===========================================================================
do $$
declare v text;
begin
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000001')$q$);
  perform t('record :: a new winner with no claim check is refused', v = 'claim_not_checked', coalesce(v, 'no error'));

  perform public.begin_claim_check('d3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001');

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000001')$q$);
  perform t('record :: a new winner whose check has no verdict is refused', v = 'claim_not_checked', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000009')$q$);
  perform t('record :: a key that is not the attempt being checked is refused', v = 'attempt_mismatch', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false, null)$q$);
  perform t('record :: no key at all is refused', v = 'attempt_mismatch', coalesce(v, 'no error'));

  perform public.check_claim('d3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', array[1, 2, 3, 4, 50]);
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000001')$q$);
  perform t('record :: an invalid verdict cannot be recorded', v = 'claim_not_valid', coalesce(v, 'no error'));

  perform t('record :: none of the refusals wrote a winner',
            not exists (select 1 from public.winners where game_id = 'd3000000-0000-4000-8000-000000000002'),
            'a winner was written');
end $$;

-- The re-check: a verdict of valid whose numbers are changed underneath it (only
-- possible here by setting the claim switch by hand, as the functions do) is
-- refused on the stored numbers, not trusted on the verdict.
do $$
declare r jsonb;
begin
  r := public.begin_claim_check('d3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', true);
  r := public.check_claim('d3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', array[16, 17, 18, 19, 20]);
  perform t('record :: fixture claim is valid', r ->> 'code' = 'valid', r ->> 'code');

  perform set_config('bingo.claim_write', 'on', true);
  update public.game_states set claim_numbers = '[1, 2, 3, 4, 5]'
   where game_id = 'd3000000-0000-4000-8000-000000000002';
end $$;

do $$
declare v text;
begin
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000002')$q$);
  perform t('record :: stored numbers that miss the last ball are refused despite a valid verdict',
            v = 'claim_not_valid', coalesce(v, 'no error'));

  perform set_config('bingo.claim_write', 'on', true);
  update public.game_states set claim_numbers = '[16, 17, 18, 19, 20, 50]'
   where game_id = 'd3000000-0000-4000-8000-000000000002';
end $$;

do $$
declare v text;
begin
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000002')$q$);
  perform t('record :: stored numbers with an uncalled number are refused despite a valid verdict',
            v = 'claim_not_valid', coalesce(v, 'no error'));

  perform set_config('bingo.claim_write', 'on', true);
  update public.game_states set claim_numbers = '[16, 17, 18, 19, 20]'
   where game_id = 'd3000000-0000-4000-8000-000000000002';
end $$;

do $$
declare s public.game_states; w public.winners;
begin
  s := public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000002');
  select * into w from public.winners where client_request_id = 'b0000000-0000-4000-8000-000000000002';

  perform t('record :: a checked valid attempt is recorded',
            w.id is not null and w.game_id = 'd3000000-0000-4000-8000-000000000002'
              and w.stage = 'Line' and w.call_count_at_win = 20,
            'no winner row');
  perform t('record :: the Line win text is LINE WINNER!',
            s.display_win_text = 'LINE WINNER!' and s.display_win_type = 'line',
            coalesce(s.display_win_text, 'null'));
  perform t('record :: the claim stays on screen under the win',
            (pg_temp.pub('d3000000-0000-4000-8000-000000000002')).claim_numbers = '[16, 17, 18, 19, 20]'::jsonb
              and (pg_temp.pub('d3000000-0000-4000-8000-000000000002')).claim_result = 'valid',
            'the public claim was cleared by the record');
  perform t('record :: the winner is anonymous', w.winner_name = 'Anonymous', w.winner_name);
end $$;

-- An idempotent retry after the stage has advanced returns the existing row.
do $$
declare v text;
begin
  update public.game_states
     set paused_for_validation = false, current_stage_index = 1,
         display_win_type = null, display_win_text = null
   where game_id = 'd3000000-0000-4000-8000-000000000002';

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Line', '£10 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000002')$q$);
  perform t('record :: a retry of a recorded winner after the stage advanced succeeds and adds nothing',
            v is null and (select count(*) = 1 from public.winners where game_id = 'd3000000-0000-4000-8000-000000000002'),
            'error=' || coalesce(v, 'none') || ' rows='
              || (select count(*) from public.winners where game_id = 'd3000000-0000-4000-8000-000000000002'));
end $$;

do $$
declare s public.game_states;
begin
  perform pg_temp.valid_claim('d3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003');
  s := public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Two Lines', '£20 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000003');
  perform t('record :: the Two Lines win text is TWO LINES WINNER!',
            s.display_win_text = 'TWO LINES WINNER!' and s.display_win_type = 'two_lines',
            coalesce(s.display_win_text, 'null'));

  update public.game_states set paused_for_validation = false, current_stage_index = 2
   where game_id = 'd3000000-0000-4000-8000-000000000002';

  perform pg_temp.valid_claim('d3000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004');
  s := public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'Full House', '£50 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000004');
  perform t('record :: the Full House win text is FULL HOUSE WINNER!',
            s.display_win_text = 'FULL HOUSE WINNER!' and s.display_win_type = 'full_house',
            coalesce(s.display_win_text, 'null'));
end $$;

-- ===========================================================================
-- The manual snowball exemption, and only it
-- ===========================================================================
do $$
declare v text;
begin
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001', 'Line', '£10 Cash', false, true, true,
        'b0000000-0000-4000-8000-000000000005')$q$);
  perform t('manual :: a forged manual flag on a standard game is refused', v = 'claim_not_checked', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000004', 'Full House', null, false, true, true,
        'b0000000-0000-4000-8000-000000000006')$q$);
  perform t('manual :: the manual flag on a snowball game whose window has closed is refused',
            v = 'claim_not_checked', coalesce(v, 'no error'));

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000002',
        'd3000000-0000-4000-8000-000000000005', 'Full House', null, false, true, true,
        'b0000000-0000-4000-8000-000000000010')$q$);
  perform t('manual :: the manual flag in a test session is refused (no window is computed there)',
            v = 'claim_not_checked', coalesce(v, 'no error'));

  perform t('manual :: the refused forges wrote no winner',
            not exists (select 1 from public.winners
                         where client_request_id in ('b0000000-0000-4000-8000-000000000005',
                                                     'b0000000-0000-4000-8000-000000000006',
                                                     'b0000000-0000-4000-8000-000000000010')),
            'a forged winner was written');
end $$;

do $$
declare s public.game_states; w public.winners; v text;
begin
  s := public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003', 'Full House', '£212.50 (Manual Snowball Win)', true, true, true,
        'b0000000-0000-4000-8000-000000000007');
  select * into w from public.winners where client_request_id = 'b0000000-0000-4000-8000-000000000007';

  perform t('manual :: a genuine manual snowball award inside the window succeeds without a claim',
            w.id is not null and w.is_snowball_jackpot and w.jackpot_pool_pence = 21250,
            'jackpot=' || coalesce(w.is_snowball_jackpot::text, 'no row') || ' pool=' || coalesce(w.jackpot_pool_pence::text, 'null'));
  perform t('manual :: the snowball text shows £212.50, two decimals',
            s.display_win_text = 'FULL HOUSE + SNOWBALL £212.50!' and s.display_win_type = 'snowball',
            coalesce(s.display_win_text, 'null'));

  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003', 'Full House', '£212.50 (Manual Snowball Win)', true, true, true,
        'b0000000-0000-4000-8000-000000000007')$q$);
  perform t('manual :: a retry of the manual award adds nothing',
            v is null and (select count(*) = 1 from public.winners where game_id = 'd3000000-0000-4000-8000-000000000003'),
            coalesce(v, 'no error'));

  -- A lost response and a re-opened modal: the same jackpot again, under a
  -- new key. It must not become a second, phantom jackpot winner.
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003', 'Full House', '£212.50 (Manual Snowball Win)', true, true, true,
        'b0000000-0000-4000-8000-000000000012')$q$);
  perform t('manual :: a second manual award under a new key is refused while a live jackpot winner stands',
            v = 'jackpot_already_won'
              and (select count(*) = 1 from public.winners where game_id = 'd3000000-0000-4000-8000-000000000003')
              and not exists (select 1 from public.winners
                               where client_request_id = 'b0000000-0000-4000-8000-000000000012'),
            coalesce(v, 'no error'));

  -- The idempotency lookup still comes first: the original key is answered
  -- with the winner on record, never with jackpot_already_won.
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003', 'Full House', '£212.50 (Manual Snowball Win)', true, true, true,
        'b0000000-0000-4000-8000-000000000007')$q$);
  perform t('manual :: after that refusal, a retry with the original key still returns the winner on record',
            v is null and (select count(*) = 1 from public.winners where game_id = 'd3000000-0000-4000-8000-000000000003'),
            coalesce(v, 'no error'));

  -- A voided jackpot winner does not count, so the jackpot can be awarded again.
  update public.winners set is_void = true, void_reason = 'test'
   where client_request_id = 'b0000000-0000-4000-8000-000000000007';
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003', 'Full House', '£212.50 (Manual Snowball Win)', true, true, true,
        'b0000000-0000-4000-8000-000000000013')$q$);
  perform t('manual :: once the jackpot winner is voided, a new manual award is accepted',
            v is null and exists (select 1 from public.winners
                                   where client_request_id = 'b0000000-0000-4000-8000-000000000013'
                                     and is_snowball_jackpot and coalesce(is_void, false) = false),
            coalesce(v, 'no error'));
end $$;

do $$
declare s public.game_states; w public.winners; v text;
begin
  perform pg_temp.valid_claim('d3000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000008');
  s := public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000006', 'Full House', '£25 Cash', false, false, true,
        'b0000000-0000-4000-8000-000000000008');
  select * into w from public.winners where client_request_id = 'b0000000-0000-4000-8000-000000000008';

  perform t('money text :: £1,250 has a thousands separator and no .00',
            w.prize_description = '£25 Cash + Snowball Jackpot £1,250'
              and s.display_win_text = 'FULL HOUSE + SNOWBALL £1,250!',
            coalesce(w.prize_description, 'null') || ' / ' || coalesce(s.display_win_text, 'null'));
  perform t('money text :: the ordinary prize is still parsed from the ordinary text',
            w.prize_amount_pence = 2500 and w.jackpot_pool_pence = 125000,
            'amount=' || coalesce(w.prize_amount_pence::text, 'null') || ' pool=' || coalesce(w.jackpot_pool_pence::text, 'null'));

  -- A jackpot winner recorded through a checked claim blocks a manual award
  -- just the same: the guard asks whether a live jackpot winner exists, not
  -- which route recorded it.
  v := pg_temp.err($q$select public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000006', 'Full House', '£1,250 (Manual Snowball Win)', true, true, true,
        'b0000000-0000-4000-8000-000000000014')$q$);
  perform t('manual :: a manual award after a checked jackpot winner is refused',
            v = 'jackpot_already_won'
              and not exists (select 1 from public.winners
                               where client_request_id = 'b0000000-0000-4000-8000-000000000014'),
            coalesce(v, 'no error'));

  perform pg_temp.valid_claim('d3000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000011');
  s := public.record_winner_atomic('d2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000006', 'Full House', '£25 Cash', false, false, false,
        'b0000000-0000-4000-8000-000000000011');
  perform t('record :: a snowball Full House not eligible for the jackpot says FULL HOUSE WINNER!',
            s.display_win_text = 'FULL HOUSE WINNER!' and s.display_win_type = 'full_house',
            coalesce(s.display_win_text, 'null'));
end $$;

-- ===========================================================================
-- Grants: anon cannot call the claim functions; a pending account is refused
-- ===========================================================================
do $$
declare
  v_call text;
  v_sig text;
  v_ok boolean;
  v_detail text;
  v_name text;
begin
  foreach v_call in array array[
    $q$select public.begin_claim_check('d3000000-0000-4000-8000-000000000001', gen_random_uuid())$q$,
    $q$select public.set_claim_draft('d3000000-0000-4000-8000-000000000001', gen_random_uuid(), array[1], 1)$q$,
    $q$select public.check_claim('d3000000-0000-4000-8000-000000000001', gen_random_uuid(), array[1, 2, 3, 4, 5])$q$,
    $q$select public.void_last_number('d3000000-0000-4000-8000-000000000001', gen_random_uuid(), 1)$q$
  ] loop
    v_name := split_part(split_part(v_call, 'public.', 2), '(', 1);
    begin
      set local role anon;
      execute v_call;
      v_ok := false;
      v_detail := 'anon ran it';
    exception when insufficient_privilege then
      v_ok := true;
      v_detail := sqlerrm;
    end;
    reset role;
    perform t('grants :: anon cannot execute ' || v_name, v_ok, v_detail);

    begin
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
      execute v_call;
      v_ok := false;
      v_detail := 'pending ran it';
    exception when others then
      v_ok := sqlerrm like 'unauthorized%';
      v_detail := sqlerrm;
    end;
    reset role;
    perform t('grants :: a pending account is refused by ' || v_name, v_ok, v_detail);
  end loop;

  foreach v_sig in array array['public.begin_claim_check(uuid, uuid, boolean)',
                               'public.set_claim_draft(uuid, uuid, integer[], integer)',
                               'public.check_claim(uuid, uuid, integer[], boolean)',
                               'public.void_last_number(uuid, uuid, integer)',
                               'public.required_claim_count(text)'] loop
    perform t('grants :: authenticated and service_role, not anon, can execute ' || v_sig,
              has_function_privilege('authenticated', v_sig, 'EXECUTE')
                and has_function_privilege('service_role', v_sig, 'EXECUTE')
                and not has_function_privilege('anon', v_sig, 'EXECUTE'),
              v_sig);
  end loop;
end $$;
