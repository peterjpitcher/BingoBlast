-- Behavioural assertions for M3, the jackpot money components
-- (20261001000300_jackpot_components.sql), run against the fully replayed
-- database in suites D and E of supabase/tests/run.sh. Winners are recorded
-- through checked claims, because M2b is in place on top.
--
-- The historic backfill needs data that predates M3, so it is tested in suite F
-- (staged-compat.test.sql), which applies M3 on top of such data.
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

-- Records a Full House through a checked claim on a snowball game.
create or replace function pg_temp.win(p_game_id uuid, p_key uuid, p_prize text, p_eligible boolean)
returns void language plpgsql as $$
begin
  perform pg_temp.valid_claim(p_game_id, p_key);
  perform public.record_winner_atomic('f2000000-0000-4000-8000-000000000001', p_game_id,
                                      'Full House', p_prize, false, false, p_eligible, p_key);
end;
$$;

-- Shares of one game's winners, in recording order, as text for a detail line.
create or replace function pg_temp.shares(p_game_id uuid) returns text
language sql as $$
  select string_agg(format('%s:amount=%s share=%s pool=%s jshare=%s void=%s',
                           left(client_request_id::text, 8) || right(client_request_id::text, 2),
                           prize_amount_pence, prize_share_pence, jackpot_pool_pence,
                           jackpot_share_pence, coalesce(is_void, false)),
                    ' | ' order by created_at, id)
    from public.winners where game_id = p_game_id;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Every snowball game has 20 balls called, inside a 40-call window.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-000000000001', 'mo-host@example.invalid');
update public.profiles set role = 'host' where id = 'f1000000-0000-4000-8000-000000000001';

insert into public.snowball_pots (
  id, name, base_max_calls, base_jackpot_amount, calls_increment, jackpot_increment,
  current_max_calls, current_jackpot_amount
) values
  ('f6000000-0000-4000-8000-000000000001', 'Money pot', 30, 20, 2, 20, 40, 140.00),
  ('f6000000-0000-4000-8000-000000000002', 'Odd pot', 30, 20, 2, 20, 40, 140.01);

insert into public.sessions (id, name, status) values
  ('f2000000-0000-4000-8000-000000000001', 'Money night', 'running');

insert into public.games (id, session_id, game_index, name, type, stage_sequence, snowball_pot_id, prizes)
select g.id, 'f2000000-0000-4000-8000-000000000001', g.idx, g.name,
       g.type::public.game_type, '["Full House"]'::jsonb, g.pot, '{"Full House": "£10 Cash"}'::jsonb
  from (values
          ('f3000000-0000-4000-8000-000000000001'::uuid, 1, 'One winner', 'snowball', 'f6000000-0000-4000-8000-000000000001'::uuid),
          ('f3000000-0000-4000-8000-000000000002'::uuid, 2, 'Two eligible', 'snowball', 'f6000000-0000-4000-8000-000000000001'::uuid),
          ('f3000000-0000-4000-8000-000000000003'::uuid, 3, 'Eligible and not', 'snowball', 'f6000000-0000-4000-8000-000000000001'::uuid),
          ('f3000000-0000-4000-8000-000000000004'::uuid, 4, 'Jackpot only', 'snowball', 'f6000000-0000-4000-8000-000000000001'::uuid),
          ('f3000000-0000-4000-8000-000000000005'::uuid, 5, 'Manual', 'snowball', 'f6000000-0000-4000-8000-000000000001'::uuid),
          ('f3000000-0000-4000-8000-000000000006'::uuid, 6, 'Odd penny', 'snowball', 'f6000000-0000-4000-8000-000000000002'::uuid),
          ('f3000000-0000-4000-8000-000000000007'::uuid, 7, 'Plain', 'standard', null::uuid)
       ) as g(id, idx, name, type, pot);

insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, controller_last_seen_at, started_at, last_call_at
)
select g.id,
       (select jsonb_agg(n order by n) from generate_series(1, 90) n),
       (select jsonb_agg(n order by n) from generate_series(1, 20) n),
       20, 0, 'in_progress', 'f1000000-0000-4000-8000-000000000001', now(), now(), now() - interval '5 seconds'
  from public.games g where g.session_id = 'f2000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', false);

-- ===========================================================================
-- One eligible winner
-- ===========================================================================
do $$
declare w public.winners;
begin
  perform pg_temp.win('f3000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', '£10 Cash', true);
  select * into w from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000001';
  perform t('money :: one eligible winner takes the whole ordinary prize and the whole jackpot',
            w.prize_description = '£10 Cash + Snowball Jackpot £140'
              and w.prize_amount_pence = 1000 and w.prize_share_pence = 1000
              and w.jackpot_pool_pence = 14000 and w.jackpot_share_pence = 14000,
            pg_temp.shares('f3000000-0000-4000-8000-000000000001'));
end $$;

-- ===========================================================================
-- Two eligible winners share both components
-- ===========================================================================
do $$
begin
  perform pg_temp.win('f3000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000021', '£10 Cash', true);
  perform pg_temp.win('f3000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000022', '£10 Cash', true);
  perform t('money :: two eligible winners split the ordinary prize and the jackpot',
            (select array_agg(prize_share_pence order by created_at, id) = array[500, 500]
                    and array_agg(jackpot_share_pence order by created_at, id) = array[7000, 7000]
                    and bool_and(jackpot_pool_pence = 14000)
               from public.winners where game_id = 'f3000000-0000-4000-8000-000000000002'),
            pg_temp.shares('f3000000-0000-4000-8000-000000000002'));
end $$;

-- ===========================================================================
-- Eligible plus ineligible: the ordinary prize between both, the jackpot to
-- the eligible one only (A2)
-- ===========================================================================
do $$
declare v_eligible public.winners; v_other public.winners;
begin
  perform pg_temp.win('f3000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000031', '£10 Cash', true);
  perform pg_temp.win('f3000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000032', '£10 Cash', false);
  select * into v_eligible from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000031';
  select * into v_other from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000032';

  perform t('money :: eligible plus ineligible share the ordinary prize',
            v_eligible.prize_share_pence = 500 and v_other.prize_share_pence = 500,
            pg_temp.shares('f3000000-0000-4000-8000-000000000003'));
  perform t('money :: only the eligible winner shares the jackpot, and takes all of it',
            v_eligible.jackpot_share_pence = 14000
              and v_other.jackpot_share_pence is null and v_other.jackpot_pool_pence is null
              and not v_other.is_snowball_jackpot,
            pg_temp.shares('f3000000-0000-4000-8000-000000000003'));
end $$;

-- ===========================================================================
-- Jackpot only: no ordinary prize text, and a manual description that names
-- the snowball. Neither counts the jackpot as an ordinary prize as well.
-- ===========================================================================
do $$
declare w public.winners;
begin
  perform pg_temp.win('f3000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000041', null, true);
  select * into w from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000041';
  perform t('money :: a jackpot with no ordinary prize has an ordinary pool of 0, not the jackpot again',
            w.prize_description = 'Snowball Jackpot £140'
              and w.prize_amount_pence = 0 and w.prize_share_pence = 0
              and w.jackpot_pool_pence = 14000 and w.jackpot_share_pence = 14000,
            pg_temp.shares('f3000000-0000-4000-8000-000000000004'));

  perform public.record_winner_atomic('f2000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000005', 'Full House', '£140 (Manual Snowball Win)', true, true, true,
        'f4000000-0000-4000-8000-000000000051');
  select * into w from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000051';
  perform t('money :: a manual award whose text names the snowball is jackpot only',
            w.prize_amount_pence = 0 and w.prize_share_pence = 0
              and w.jackpot_pool_pence = 14000 and w.jackpot_share_pence = 14000,
            pg_temp.shares('f3000000-0000-4000-8000-000000000005'));
end $$;

-- ===========================================================================
-- The odd penny goes to the earliest, on the jackpot as on the ordinary prize
-- ===========================================================================
do $$
begin
  perform pg_temp.win('f3000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000061', '£10 Cash', true);
  perform pg_temp.win('f3000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000062', '£10 Cash', true);
  perform t('money :: a jackpot of £140.01 two ways gives the odd penny to the earliest',
            (select array_agg(jackpot_share_pence order by created_at, id) = array[7001, 7000]
                    and sum(jackpot_share_pence) = 14001
                    and array_agg(prize_share_pence order by created_at, id) = array[500, 500]
               from public.winners where game_id = 'f3000000-0000-4000-8000-000000000006'),
            pg_temp.shares('f3000000-0000-4000-8000-000000000006'));

  perform t('money :: the jackpot text shows the pence',
            (select prize_description = '£10 Cash + Snowball Jackpot £140.01' from public.winners
              where client_request_id = 'f4000000-0000-4000-8000-000000000061'),
            (select prize_description from public.winners
              where client_request_id = 'f4000000-0000-4000-8000-000000000061'));
end $$;

-- ===========================================================================
-- A void recomputes both components
-- ===========================================================================
do $$
declare v_voided public.winners; v_kept public.winners;
begin
  update public.winners set is_void = true, void_reason = 'test'
   where client_request_id = 'f4000000-0000-4000-8000-000000000021';
  select * into v_voided from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000021';
  select * into v_kept from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000022';

  perform t('money :: voiding one of two eligible winners gives the other both whole components',
            v_kept.prize_share_pence = 1000 and v_kept.jackpot_share_pence = 14000,
            pg_temp.shares('f3000000-0000-4000-8000-000000000002'));
  perform t('money :: the voided winner keeps its pool as a record and takes no share of either',
            v_voided.prize_share_pence is null and v_voided.jackpot_share_pence is null
              and v_voided.jackpot_pool_pence = 14000,
            pg_temp.shares('f3000000-0000-4000-8000-000000000002'));

  update public.winners set is_void = false, void_reason = null
   where client_request_id = 'f4000000-0000-4000-8000-000000000021';
  perform t('money :: un-voiding splits both components again',
            (select array_agg(jackpot_share_pence order by created_at, id) = array[7000, 7000]
               from public.winners where game_id = 'f3000000-0000-4000-8000-000000000002'),
            pg_temp.shares('f3000000-0000-4000-8000-000000000002'));
end $$;

-- ===========================================================================
-- An idempotent retry still works and changes no money
-- ===========================================================================
do $$
declare v text; v_before text;
begin
  v_before := pg_temp.shares('f3000000-0000-4000-8000-000000000001');
  v := pg_temp.err($q$select public.record_winner_atomic('f2000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001', 'Full House', '£10 Cash', false, false, true,
        'f4000000-0000-4000-8000-000000000001')$q$);
  perform t('money :: a retry of a recorded jackpot winner adds no row and moves no money',
            v is null and pg_temp.shares('f3000000-0000-4000-8000-000000000001') = v_before
              and (select count(*) = 1 from public.winners where game_id = 'f3000000-0000-4000-8000-000000000001'),
            coalesce(v, 'no error') || ' / ' || pg_temp.shares('f3000000-0000-4000-8000-000000000001'));
end $$;

-- ===========================================================================
-- The prize-given refusal on a voided winner (X14)
-- ===========================================================================
do $$
declare v text; v_given boolean; v_id uuid;
begin
  update public.winners set is_void = true, void_reason = 'test'
   where client_request_id = 'f4000000-0000-4000-8000-000000000032'
  returning id into v_id;

  v := pg_temp.err(format($q$select public.set_winner_prize_given(%L, 'f2000000-0000-4000-8000-000000000001', true)$q$, v_id));
  perform t('prize given :: a voided winner cannot be marked as paid', v = 'winner_void', coalesce(v, 'no error'));

  v := pg_temp.err(format($q$select public.set_winner_prize_given(%L, 'f2000000-0000-4000-8000-000000000001', false)$q$, v_id));
  perform t('prize given :: nor unmarked', v = 'winner_void', coalesce(v, 'no error'));

  select id into v_id from public.winners where client_request_id = 'f4000000-0000-4000-8000-000000000031';
  v_given := public.set_winner_prize_given(v_id, 'f2000000-0000-4000-8000-000000000001', true);
  perform t('prize given :: a live winner can still be marked as paid', v_given, 'returned false');
end $$;

-- ===========================================================================
-- The settle guard (X7)
-- ===========================================================================
do $$
declare v text; r record;
begin
  v := pg_temp.err($q$select * from public.settle_snowball_pot('f3000000-0000-4000-8000-000000000001')$q$);
  perform t('settle :: refused while the game is still in progress', v = 'game_not_completed', coalesce(v, 'no error'));

  perform t('settle :: the refusal moved no money',
            (select current_jackpot_amount = 140.00 from public.snowball_pots
              where id = 'f6000000-0000-4000-8000-000000000001')
              and not exists (select 1 from public.snowball_pot_history
                               where game_id = 'f3000000-0000-4000-8000-000000000001'),
            'the pot or its history moved');

  select * into r from public.settle_snowball_pot('f3000000-0000-4000-8000-000000000007');
  perform t('settle :: a game that is not a snowball is still a no-op, finished or not',
            r.outcome = 'not_snowball', r.outcome);

  perform public.finish_game('f3000000-0000-4000-8000-000000000001');
  select * into r from public.settle_snowball_pot('f3000000-0000-4000-8000-000000000001');
  perform t('settle :: a completed game settles, and a jackpot win resets the pot',
            r.outcome = 'settled' and r.settlement = 'reset' and r.new_jackpot_amount = 20,
            r.outcome || '/' || coalesce(r.settlement, 'null'));

  select * into r from public.settle_snowball_pot('f3000000-0000-4000-8000-000000000001');
  perform t('settle :: a second settlement is already_settled', r.outcome = 'already_settled', r.outcome);
end $$;
