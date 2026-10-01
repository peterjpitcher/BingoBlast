-- Behavioural assertions for M1, the night lifecycle
-- (20261001075034_night_lifecycle.sql), run against the fully replayed database
-- in suites D and E of supabase/tests/run.sh.
--
-- Every branch of start_game, finish_game and end_night, the sessions stamp
-- trigger, the reset clearing started_at, the started_at backfill and a rerun of
-- it, and the grants. The two-connection races live in run.sh, because one
-- connection cannot hold a lock against itself.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- The error a statement raises, or null when it succeeds. pg_temp keeps the
-- helpers out of public, where the replay's function count would see them.
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

create or replace function pg_temp.seq90() returns integer[]
language sql as $$
  select array_agg(g order by g) from generate_series(1, 90) g;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed uuids in their own range, so nothing here collides with
-- remediation-behaviour.test.sql, which runs first against the same database.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000001', 'lc-host@example.invalid'),
  ('c1000000-0000-4000-8000-000000000002', 'lc-rival@example.invalid'),
  ('c1000000-0000-4000-8000-000000000003', 'lc-admin@example.invalid'),
  ('c1000000-0000-4000-8000-000000000004', 'lc-pending@example.invalid');

update public.profiles set role = 'host'
 where id in ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002');
update public.profiles set role = 'admin' where id = 'c1000000-0000-4000-8000-000000000003';

insert into public.sessions (id, name, status) values
  ('c2000000-0000-4000-8000-000000000001', 'Lifecycle night', 'ready'),
  ('c2000000-0000-4000-8000-000000000002', 'End with unplayed', 'running'),
  ('c2000000-0000-4000-8000-000000000003', 'Sequences', 'ready'),
  ('c2000000-0000-4000-8000-000000000004', 'Backfill', 'completed');

insert into public.games (id, session_id, game_index, name, type) values
  ('c3000000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000001', 1, 'Game 1', 'standard'),
  ('c3000000-0000-4000-8000-000000000012', 'c2000000-0000-4000-8000-000000000001', 2, 'Game 2', 'standard'),
  ('c3000000-0000-4000-8000-000000000021', 'c2000000-0000-4000-8000-000000000002', 1, 'Game 1', 'standard'),
  ('c3000000-0000-4000-8000-000000000022', 'c2000000-0000-4000-8000-000000000002', 2, 'Game 2', 'standard'),
  ('c3000000-0000-4000-8000-000000000031', 'c2000000-0000-4000-8000-000000000003', 1, 'Fresh', 'standard'),
  ('c3000000-0000-4000-8000-000000000032', 'c2000000-0000-4000-8000-000000000003', 2, 'Pre-made', 'standard'),
  ('c3000000-0000-4000-8000-000000000041', 'c2000000-0000-4000-8000-000000000004', 1, 'Old game', 'standard');

select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');

-- ===========================================================================
-- The stamp trigger
-- ===========================================================================
do $$
declare v_before bigint; v_after bigint;
begin
  select state_version into v_before from public.sessions where id = 'c2000000-0000-4000-8000-000000000003';
  update public.sessions set notes = 'touched' where id = 'c2000000-0000-4000-8000-000000000003';
  select state_version into v_after from public.sessions where id = 'c2000000-0000-4000-8000-000000000003';
  perform t('lifecycle :: any session update bumps state_version',
            v_after = v_before + 1, v_before || ' -> ' || v_after);
end $$;

-- ===========================================================================
-- start_game: a fresh start, the first start stamping started_at
-- ===========================================================================
do $$
declare v_state public.game_states; v_session public.sessions;
begin
  v_state := public.start_game('c3000000-0000-4000-8000-000000000011', pg_temp.seq90());
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';

  perform t('start :: a fresh start creates an in_progress state controlled by the caller',
            v_state.status = 'in_progress'
              and v_state.controlling_host_id = 'c1000000-0000-4000-8000-000000000001'
              and v_state.numbers_called_count = 0 and v_state.started_at is not null,
            'status=' || v_state.status || ' controller=' || coalesce(v_state.controlling_host_id::text, 'null'));

  perform t('start :: the fresh state stores the sequence it was given',
            v_state.number_sequence = to_jsonb(pg_temp.seq90()),
            'number_sequence was not the one passed in');

  perform t('start :: the fresh state takes the column default reveal delay',
            v_state.call_delay_seconds = 3, 'call_delay_seconds=' || v_state.call_delay_seconds);

  perform t('start :: the session is running, points at the game and has started_at',
            v_session.status = 'running'
              and v_session.active_game_id = 'c3000000-0000-4000-8000-000000000011'
              and v_session.started_at is not null,
            'status=' || v_session.status || ' started_at=' || coalesce(v_session.started_at::text, 'null'));
end $$;

do $$
declare v_msg text; v_status text;
begin
  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000012', pg_temp.seq90())$q$);
  select gs.status::text into v_status from public.game_states gs
   where gs.game_id = 'c3000000-0000-4000-8000-000000000012';
  perform t('start :: a second game cannot start while one is in progress',
            v_msg = 'other_game_in_progress' and v_status is null,
            'message=' || coalesce(v_msg, 'none') || ' second game status=' || coalesce(v_status, 'no row'));
end $$;

-- ===========================================================================
-- finish_game: the controller, idempotency, the session staying open
-- ===========================================================================
update public.game_states set current_stage_index = 1
 where game_id = 'c3000000-0000-4000-8000-000000000011';

do $$
declare v_msg text;
begin
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
  v_msg := pg_temp.err($q$select public.finish_game('c3000000-0000-4000-8000-000000000011')$q$);
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
  perform t('finish :: a host who is not the controller is refused',
            v_msg = 'not_controller', 'message=' || coalesce(v_msg, 'none'));
end $$;

do $$
declare v_result jsonb; v_retry jsonb; v_session public.sessions;
begin
  v_result := public.finish_game('c3000000-0000-4000-8000-000000000011');
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';

  perform t('finish :: the game is completed with ended_at set',
            v_result -> 'game_state' ->> 'status' = 'completed'
              and v_result -> 'game_state' ->> 'ended_at' is not null,
            v_result::text);

  perform t('finish :: session_completed is false while another game is unplayed',
            (v_result ->> 'session_completed')::boolean = false
              and v_session.status = 'running' and v_session.completed_at is null,
            'session status=' || v_session.status);

  perform t('finish :: active_game_id is cleared when it pointed at the finished game',
            v_session.active_game_id is null,
            'active_game_id=' || coalesce(v_session.active_game_id::text, 'null'));

  v_retry := public.finish_game('c3000000-0000-4000-8000-000000000011');
  perform t('finish :: a repeat returns the same completed state and changes nothing',
            v_retry -> 'game_state' ->> 'ended_at' = v_result -> 'game_state' ->> 'ended_at'
              and v_retry -> 'game_state' ->> 'state_version' = v_result -> 'game_state' ->> 'state_version',
            'first=' || (v_result -> 'game_state' ->> 'state_version')
              || ' retry=' || (v_retry -> 'game_state' ->> 'state_version'));
end $$;

do $$
declare v_msg text;
begin
  -- A not-controlling host retrying a finish that already landed is not refused:
  -- the idempotent path comes before the controller check.
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
  v_msg := pg_temp.err($q$select public.finish_game('c3000000-0000-4000-8000-000000000011')$q$);
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
  perform t('finish :: a retry of a completed game succeeds for any host',
            v_msg is null, 'message=' || coalesce(v_msg, 'none'));
end $$;

-- ===========================================================================
-- start_game: a re-open keeps started_at and the stage
-- ===========================================================================
do $$
declare
  v_started_before timestamptz;
  v_state public.game_states;
  v_session public.sessions;
begin
  select started_at into v_started_before from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';
  perform pg_sleep(0.01);
  v_state := public.start_game('c3000000-0000-4000-8000-000000000011', null);
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';

  perform t('start :: a re-open puts the game back in progress with ended_at cleared',
            v_state.status = 'in_progress' and v_state.ended_at is null,
            'status=' || v_state.status);
  perform t('start :: a re-open keeps the stage',
            v_state.current_stage_index = 1, 'stage=' || v_state.current_stage_index);
  perform t('start :: a re-open keeps the session started_at',
            v_session.started_at = v_started_before,
            v_started_before || ' -> ' || v_session.started_at);
  perform t('start :: a re-open points the session at the game again',
            v_session.active_game_id = 'c3000000-0000-4000-8000-000000000011', 'active_game_id');
end $$;

-- ===========================================================================
-- start_game: a takeover
-- ===========================================================================
do $$
declare v_state public.game_states; v_msg text;
begin
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
  v_state := public.start_game('c3000000-0000-4000-8000-000000000011', null);
  perform t('start :: starting an in-progress game hands control to the caller',
            v_state.controlling_host_id = 'c1000000-0000-4000-8000-000000000002'
              and v_state.status = 'in_progress' and v_state.current_stage_index = 1,
            'controller=' || coalesce(v_state.controlling_host_id::text, 'null'));

  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
  v_msg := pg_temp.err($q$select public.finish_game('c3000000-0000-4000-8000-000000000011')$q$);
  perform t('start :: after a takeover the previous controller cannot finish',
            v_msg = 'not_controller', 'message=' || coalesce(v_msg, 'none'));

  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
  perform public.finish_game('c3000000-0000-4000-8000-000000000011');
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
end $$;

-- ===========================================================================
-- finishing the last game completes the night
-- ===========================================================================
do $$
declare v_result jsonb; v_session public.sessions;
begin
  perform public.start_game('c3000000-0000-4000-8000-000000000012', pg_temp.seq90());
  v_result := public.finish_game('c3000000-0000-4000-8000-000000000012');
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';

  perform t('finish :: finishing the last game completes the session',
            (v_result ->> 'session_completed')::boolean = true and v_session.status = 'completed',
            'session_completed=' || (v_result ->> 'session_completed') || ' status=' || v_session.status);
  perform t('finish :: completing the session stamps completed_at',
            v_session.completed_at is not null, 'completed_at is null');
  perform t('finish :: completing the session clears active_game_id',
            v_session.active_game_id is null, 'active_game_id still set');
end $$;

do $$
declare v_first timestamptz; v_session public.sessions; v_msg text;
begin
  select completed_at into v_first from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';
  perform pg_sleep(0.01);
  v_session := public.end_night('c2000000-0000-4000-8000-000000000001');
  perform t('end :: a repeated end_night keeps the first completed_at',
            v_session.status = 'completed' and v_session.completed_at = v_first,
            v_first || ' -> ' || coalesce(v_session.completed_at::text, 'null'));

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000011', null)$q$);
  perform t('start :: a start on a completed night is refused',
            v_msg = 'night_ended', 'message=' || coalesce(v_msg, 'none'));

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000012', null)$q$);
  perform t('start :: a re-open on a completed night is refused too',
            v_msg = 'night_ended'
              and (select status = 'completed' from public.game_states
                    where game_id = 'c3000000-0000-4000-8000-000000000012'),
            'message=' || coalesce(v_msg, 'none'));
end $$;

-- A night ended by mistake: the admin sets it running again. The trigger clears
-- completed_at, and the next end stamps a new one.
do $$
declare v_session public.sessions;
begin
  update public.sessions set status = 'running' where id = 'c2000000-0000-4000-8000-000000000001'
  returning * into v_session;
  perform t('lifecycle :: leaving completed clears completed_at',
            v_session.completed_at is null, 'completed_at=' || coalesce(v_session.completed_at::text, 'null'));

  v_session := public.end_night('c2000000-0000-4000-8000-000000000001');
  perform t('lifecycle :: ending again stamps a fresh completed_at',
            v_session.completed_at is not null and v_session.status = 'completed', 'completed_at is null');
end $$;

-- ===========================================================================
-- reset clears started_at and completed_at
-- ===========================================================================
do $$
declare v_session public.sessions;
begin
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000003');
  perform public.reset_session_safe('c2000000-0000-4000-8000-000000000001');
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';

  perform t('reset :: clears started_at and completed_at and returns the night to ready',
            v_session.started_at is null and v_session.completed_at is null
              and v_session.status = 'ready' and v_session.active_game_id is null,
            'status=' || v_session.status || ' started_at=' || coalesce(v_session.started_at::text, 'null')
              || ' completed_at=' || coalesce(v_session.completed_at::text, 'null'));
end $$;

do $$
declare v_session public.sessions;
begin
  perform public.start_game('c3000000-0000-4000-8000-000000000011', pg_temp.seq90());
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000001';
  perform t('reset :: the next first game after a reset sets a new started_at',
            v_session.started_at is not null and v_session.status = 'running', 'started_at is null');
end $$;

-- ===========================================================================
-- end_night refuses while a game is in progress, and leaves unplayed games
-- ===========================================================================
do $$
declare v_msg text; v_session public.sessions; v_first timestamptz;
begin
  perform public.start_game('c3000000-0000-4000-8000-000000000021', pg_temp.seq90());

  v_msg := pg_temp.err($q$select public.end_night('c2000000-0000-4000-8000-000000000002')$q$);
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000002';
  perform t('end :: end_night refuses while a game is in progress',
            v_msg = 'game_in_progress' and v_session.status = 'running',
            'message=' || coalesce(v_msg, 'none') || ' status=' || v_session.status);

  perform public.finish_game('c3000000-0000-4000-8000-000000000021');
  v_session := public.end_night('c2000000-0000-4000-8000-000000000002');
  perform t('end :: with no game in progress the night completes, unplayed games and all',
            v_session.status = 'completed' and v_session.completed_at is not null
              and v_session.active_game_id is null,
            'status=' || v_session.status);

  perform t('end :: an unplayed game stays unplayed',
            not exists (select 1 from public.game_states
                         where game_id = 'c3000000-0000-4000-8000-000000000022'),
            'the unplayed game gained a state row');

  v_first := v_session.completed_at;
  perform pg_sleep(0.01);
  v_session := public.end_night('c2000000-0000-4000-8000-000000000002');
  perform t('end :: end_night is idempotent',
            v_session.completed_at = v_first, v_first || ' -> ' || v_session.completed_at);
end $$;

-- ===========================================================================
-- Sequences, and a fresh start on a not_started row
-- ===========================================================================
do $$
declare v_msg text;
begin
  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000031',
                          (select array_agg(g) from generate_series(1, 89) g))$q$);
  perform t('start :: a sequence of 89 numbers is refused', v_msg = 'invalid_sequence',
            'message=' || coalesce(v_msg, 'none'));

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000031',
                          array[1, 1] || (select array_agg(g) from generate_series(3, 90) g))$q$);
  perform t('start :: a sequence with a duplicate is refused', v_msg = 'invalid_sequence',
            'message=' || coalesce(v_msg, 'none'));

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000031',
                          (select array_agg(g) from generate_series(2, 91) g))$q$);
  perform t('start :: a sequence outside 1 to 90 is refused', v_msg = 'invalid_sequence',
            'message=' || coalesce(v_msg, 'none'));

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000031', null)$q$);
  perform t('start :: a fresh start with no sequence is refused', v_msg = 'invalid_sequence',
            'message=' || coalesce(v_msg, 'none'));

  perform t('start :: a refused start leaves no state and no running session',
            not exists (select 1 from public.game_states where game_id = 'c3000000-0000-4000-8000-000000000031')
              and (select status = 'ready' from public.sessions where id = 'c2000000-0000-4000-8000-000000000003'),
            'a refused start wrote something');
end $$;

insert into public.game_states (game_id, number_sequence, status, call_delay_seconds)
values ('c3000000-0000-4000-8000-000000000032',
        (select jsonb_agg(g order by g desc) from generate_series(1, 90) g),
        'not_started', 5);

do $$
declare v_state public.game_states;
begin
  v_state := public.start_game('c3000000-0000-4000-8000-000000000032', pg_temp.seq90());
  perform t('start :: a not_started row keeps the sequence it already holds',
            v_state.number_sequence = (select jsonb_agg(g order by g desc) from generate_series(1, 90) g)
              and v_state.status = 'in_progress',
            'the stored sequence was replaced');
  perform t('start :: a not_started row keeps its reveal delay',
            v_state.call_delay_seconds = 5, 'call_delay_seconds=' || v_state.call_delay_seconds);
  perform public.finish_game('c3000000-0000-4000-8000-000000000032');
end $$;

-- ===========================================================================
-- The backfill, and a rerun of it. The whole migration is applied again here,
-- which is exactly what `db push` against a repaired history can do.
-- ===========================================================================
insert into public.game_states (game_id, number_sequence, status, started_at, ended_at)
values ('c3000000-0000-4000-8000-000000000041', to_jsonb(pg_temp.seq90()), 'completed',
        '2026-09-01 19:30:00+01', '2026-09-01 20:10:00+01');

update public.sessions set started_at = null where id = 'c2000000-0000-4000-8000-000000000004';

create temp table lc_before as
  select id, started_at, completed_at, state_version from public.sessions;

\ir ../migrations/20261001075034_night_lifecycle.sql

do $$
declare v_started timestamptz; v_completed timestamptz;
begin
  select started_at, completed_at into v_started, v_completed
    from public.sessions where id = 'c2000000-0000-4000-8000-000000000004';
  perform t('backfill :: a night with a started game gets started_at from its earliest game',
            v_started = '2026-09-01 19:30:00+01', 'started_at=' || coalesce(v_started::text, 'null'));
  perform t('backfill :: completed_at is not backfilled',
            v_completed is null, 'completed_at=' || coalesce(v_completed::text, 'null'));
  perform t('backfill :: a night that already has started_at is untouched',
            not exists (select 1 from public.sessions s join lc_before b on b.id = s.id
                         where b.started_at is not null
                           and (s.started_at is distinct from b.started_at
                                or s.state_version is distinct from b.state_version)),
            'the backfill touched a session it should have left alone');
end $$;

drop table lc_before;
create temp table lc_before as
  select id, started_at, state_version from public.sessions;

\ir ../migrations/20261001075034_night_lifecycle.sql

do $$
begin
  perform t('backfill :: a rerun writes nothing, not even a version bump',
            not exists (select 1 from public.sessions s join lc_before b on b.id = s.id
                         where s.started_at is distinct from b.started_at
                            or s.state_version is distinct from b.state_version),
            'a rerun of the migration changed a session');
end $$;

-- ===========================================================================
-- The cash jackpot amount. A host starting a jackpot game saves its prize in
-- start_game, because games UPDATE is admin only and the host has no other
-- way to write it. Every refusal must leave the game exactly as it was.
-- ===========================================================================
insert into public.sessions (id, name, status) values
  ('c2000000-0000-4000-8000-000000000005', 'Cash jackpot night', 'ready');

insert into public.games (id, session_id, game_index, name, type, stage_sequence, prizes) values
  ('c3000000-0000-4000-8000-000000000051', 'c2000000-0000-4000-8000-000000000005', 1, 'Jackpot',
   'jackpot', '["Full House"]', '{"Full House": "TBC"}'),
  ('c3000000-0000-4000-8000-000000000052', 'c2000000-0000-4000-8000-000000000005', 2, 'Jackpot bad amounts',
   'jackpot', '["Full House"]', '{"Full House": "£50 Cash"}'),
  ('c3000000-0000-4000-8000-000000000053', 'c2000000-0000-4000-8000-000000000005', 3, 'Standard',
   'standard', '["Line", "Two Lines", "Full House"]', '{"Line": "£5", "Two Lines": "£10", "Full House": "£20"}'),
  ('c3000000-0000-4000-8000-000000000054', 'c2000000-0000-4000-8000-000000000005', 4, 'Jackpot two stages',
   'jackpot', '["Line", "Full House"]', '{"Line": "£5", "Full House": "£20"}'),
  ('c3000000-0000-4000-8000-000000000055', 'c2000000-0000-4000-8000-000000000005', 5, 'Jackpot whole pounds',
   'jackpot', '["Full House"]', '{}');

create temp table cj_before as
  select id, prizes from public.games where session_id = 'c2000000-0000-4000-8000-000000000005';

-- True when the game's prizes, state and session are untouched by a refusal.
create or replace function pg_temp.cj_untouched(p_game_id uuid) returns boolean
language sql as $$
  select (select g.prizes from public.games g where g.id = p_game_id)
           is not distinct from (select b.prizes from cj_before b where b.id = p_game_id)
     and not exists (select 1 from public.game_states where game_id = p_game_id)
     and (select status = 'ready' from public.sessions where id = 'c2000000-0000-4000-8000-000000000005');
$$;

do $$
declare v_msg text; v_amount text;
begin
  foreach v_amount in array array['0', '-5', '12.345', 'NaN', 'Infinity'] loop
    v_msg := pg_temp.err(format(
      $q$select public.start_game('c3000000-0000-4000-8000-000000000052', pg_temp.seq90(), %L::numeric)$q$,
      v_amount));
    perform t('cash jackpot :: an amount of ' || v_amount || ' is refused and nothing is written',
              v_msg = 'invalid_cash_jackpot' and pg_temp.cj_untouched('c3000000-0000-4000-8000-000000000052'),
              'message=' || coalesce(v_msg, 'none'));
  end loop;

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000053', pg_temp.seq90(), 100)$q$);
  perform t('cash jackpot :: an amount on a standard game is refused and nothing is written',
            v_msg = 'cash_jackpot_not_allowed' and pg_temp.cj_untouched('c3000000-0000-4000-8000-000000000053'),
            'message=' || coalesce(v_msg, 'none'));

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000054', pg_temp.seq90(), 100)$q$);
  perform t('cash jackpot :: an amount on a jackpot game with two stages is refused and nothing is written',
            v_msg = 'cash_jackpot_stage_count' and pg_temp.cj_untouched('c3000000-0000-4000-8000-000000000054'),
            'message=' || coalesce(v_msg, 'none'));
end $$;

-- A host, not an admin, through the role the app uses: start_game is the only
-- way that host can write games.prizes.
do $$
declare v_seq integer[] := pg_temp.seq90(); v_state public.game_states; v_prizes jsonb; v_status text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
  v_state := public.start_game('c3000000-0000-4000-8000-000000000051', v_seq, 1250.5);
  reset role;

  select prizes into v_prizes from public.games where id = 'c3000000-0000-4000-8000-000000000051';
  select status::text into v_status from public.sessions where id = 'c2000000-0000-4000-8000-000000000005';
  perform t('cash jackpot :: a host starts a jackpot game with an amount, and the Full House prize is the exact text',
            v_prizes = '{"Full House": "£1,250.50 Cash Jackpot"}'::jsonb,
            'prizes=' || coalesce(v_prizes::text, 'null'));
  perform t('cash jackpot :: the same call started the game for that host and set the night running',
            v_state.status = 'in_progress'
              and v_state.controlling_host_id = 'c1000000-0000-4000-8000-000000000001'
              and v_status = 'running',
            'state=' || coalesce(v_state.status::text, 'null') || ' session=' || coalesce(v_status, 'null'));
end $$;

do $$
declare v_msg text; v_prizes jsonb; v_state public.game_states;
begin
  -- A takeover with an amount: another host typed one for a game already started.
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000051', null, 200)$q$);
  perform pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
  select prizes into v_prizes from public.games where id = 'c3000000-0000-4000-8000-000000000051';
  select * into v_state from public.game_states where game_id = 'c3000000-0000-4000-8000-000000000051';
  perform t('cash jackpot :: an amount on a takeover is refused, and the prize and controller stay',
            v_msg = 'cash_jackpot_not_allowed'
              and v_prizes = '{"Full House": "£1,250.50 Cash Jackpot"}'::jsonb
              and v_state.controlling_host_id = 'c1000000-0000-4000-8000-000000000001',
            'message=' || coalesce(v_msg, 'none') || ' prizes=' || coalesce(v_prizes::text, 'null'));

  perform public.finish_game('c3000000-0000-4000-8000-000000000051');

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000051', null, 200)$q$);
  select prizes into v_prizes from public.games where id = 'c3000000-0000-4000-8000-000000000051';
  perform t('cash jackpot :: an amount on a re-open is refused, and the game stays finished with its prize',
            v_msg = 'cash_jackpot_not_allowed'
              and v_prizes = '{"Full House": "£1,250.50 Cash Jackpot"}'::jsonb
              and (select status = 'completed' from public.game_states
                    where game_id = 'c3000000-0000-4000-8000-000000000051'),
            'message=' || coalesce(v_msg, 'none'));
end $$;

do $$
declare v_state public.game_states;
begin
  v_state := public.start_game('c3000000-0000-4000-8000-000000000052', pg_temp.seq90(), null);
  perform t('cash jackpot :: a jackpot game started with no amount keeps its prizes',
            v_state.status = 'in_progress'
              and (select prizes = '{"Full House": "£50 Cash"}'::jsonb from public.games
                    where id = 'c3000000-0000-4000-8000-000000000052'),
            'status=' || coalesce(v_state.status::text, 'null'));
  perform public.finish_game('c3000000-0000-4000-8000-000000000052');

  perform public.start_game('c3000000-0000-4000-8000-000000000055', pg_temp.seq90(), 125);
  perform t('cash jackpot :: whole pounds read without pence, and an empty prize list gains the stage',
            (select prizes = '{"Full House": "£125 Cash Jackpot"}'::jsonb from public.games
              where id = 'c3000000-0000-4000-8000-000000000055'),
            (select prizes::text from public.games where id = 'c3000000-0000-4000-8000-000000000055'));
  perform public.finish_game('c3000000-0000-4000-8000-000000000055');
end $$;

drop table cj_before;

-- ===========================================================================
-- A snowball game whose pot has settled cannot be re-opened. A Full House won
-- after the re-open would be judged against the pot as it now stands (already
-- reset or rolled over), and settle_snowball_pot would then answer
-- already_settled, so the pot would be paid at the wrong value and never reset.
-- A third, unplayed game keeps the night open, so the refusal is
-- snowball_settled and not night_ended.
-- ===========================================================================
insert into public.snowball_pots (
  id, name, base_max_calls, base_jackpot_amount, calls_increment, jackpot_increment,
  current_max_calls, current_jackpot_amount
) values
  ('c6000000-0000-4000-8000-000000000001', 'Lifecycle pot', 30, 20, 2, 20, 40, 100.00);

insert into public.sessions (id, name, status) values
  ('c2000000-0000-4000-8000-000000000006', 'Snowball re-open night', 'ready');

insert into public.games (id, session_id, game_index, name, type, stage_sequence, snowball_pot_id, prizes) values
  ('c3000000-0000-4000-8000-000000000061', 'c2000000-0000-4000-8000-000000000006', 1, 'Snowball settled',
   'snowball', '["Full House"]', 'c6000000-0000-4000-8000-000000000001', '{"Full House": "£10 Cash"}'),
  ('c3000000-0000-4000-8000-000000000062', 'c2000000-0000-4000-8000-000000000006', 2, 'Snowball unsettled',
   'snowball', '["Full House"]', 'c6000000-0000-4000-8000-000000000001', '{"Full House": "£10 Cash"}'),
  ('c3000000-0000-4000-8000-000000000063', 'c2000000-0000-4000-8000-000000000006', 3, 'Still to play',
   'standard', '["Line"]', null, '{"Line": "£5"}');

do $$
declare
  v_msg text;
  r record;
  v_pot public.snowball_pots;
  v_state public.game_states;
  v_session public.sessions;
begin
  perform public.start_game('c3000000-0000-4000-8000-000000000061', pg_temp.seq90());
  perform public.finish_game('c3000000-0000-4000-8000-000000000061');
  select * into r from public.settle_snowball_pot('c3000000-0000-4000-8000-000000000061');
  if r.outcome is distinct from 'settled' then
    raise exception 'fixture settlement did not settle: %', r.outcome;
  end if;
  select * into v_pot from public.snowball_pots where id = 'c6000000-0000-4000-8000-000000000001';

  v_msg := pg_temp.err($q$select public.start_game('c3000000-0000-4000-8000-000000000061', null)$q$);
  select * into v_state from public.game_states where game_id = 'c3000000-0000-4000-8000-000000000061';
  select * into v_session from public.sessions where id = 'c2000000-0000-4000-8000-000000000006';
  perform t('start :: a snowball game whose pot has settled cannot be re-opened',
            v_msg = 'snowball_settled', 'message=' || coalesce(v_msg, 'none'));
  perform t('start :: the refused re-open leaves the game finished, the night idle and the pot where settlement put it',
            v_state.status = 'completed' and v_state.ended_at is not null
              and v_session.status = 'running' and v_session.active_game_id is null
              and (select current_jackpot_amount = v_pot.current_jackpot_amount
                          and current_max_calls = v_pot.current_max_calls
                     from public.snowball_pots where id = 'c6000000-0000-4000-8000-000000000001'),
            'game=' || v_state.status || ' session=' || v_session.status
              || ' active_game_id=' || coalesce(v_session.active_game_id::text, 'null'));

  -- Should the re-open have gone through, finish the game again so the rest
  -- of this file still runs and reports.
  if v_msg is null then
    perform public.finish_game('c3000000-0000-4000-8000-000000000061');
  end if;

  perform public.start_game('c3000000-0000-4000-8000-000000000062', pg_temp.seq90());
  perform public.finish_game('c3000000-0000-4000-8000-000000000062');
  v_state := public.start_game('c3000000-0000-4000-8000-000000000062', null);
  perform t('start :: a finished snowball game whose pot has not settled still re-opens',
            v_state.status = 'in_progress' and v_state.ended_at is null,
            'status=' || v_state.status);
  perform public.finish_game('c3000000-0000-4000-8000-000000000062');
end $$;

-- ===========================================================================
-- Grants: anon cannot call any of the three, and a pending account is refused
-- by the role guard. The replay's grant matrix covers the catalogue; these
-- cover what a caller actually gets.
-- ===========================================================================
do $$
declare
  v_sig text;
  v_call text;
  v_ok boolean;
  v_detail text;
begin
  foreach v_call in array array[
    $q$select public.start_game('c3000000-0000-4000-8000-000000000031', null)$q$,
    $q$select public.finish_game('c3000000-0000-4000-8000-000000000031')$q$,
    $q$select public.end_night('c2000000-0000-4000-8000-000000000003')$q$
  ] loop
    begin
      set local role anon;
      execute v_call;
      v_ok := false;
      v_detail := 'anon ran: ' || v_call;
    exception when insufficient_privilege then
      v_ok := true;
      v_detail := sqlerrm;
    end;
    reset role;
    perform t('grants :: anon cannot execute ' || split_part(split_part(v_call, 'public.', 2), '(', 1),
              v_ok, v_detail);

    begin
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', true);
      execute v_call;
      v_ok := false;
      v_detail := 'pending ran: ' || v_call;
    exception when others then
      v_ok := sqlerrm like 'unauthorized%';
      v_detail := sqlerrm;
    end;
    reset role;
    perform t('grants :: a pending account is refused by ' || split_part(split_part(v_call, 'public.', 2), '(', 1),
              v_ok, v_detail);
  end loop;

  foreach v_sig in array array['public.start_game(uuid, integer[], numeric)', 'public.finish_game(uuid)',
                               'public.end_night(uuid)'] loop
    perform t('grants :: authenticated and service_role can execute ' || v_sig,
              has_function_privilege('authenticated', v_sig, 'EXECUTE')
                and has_function_privilege('service_role', v_sig, 'EXECUTE')
                and not has_function_privilege('anon', v_sig, 'EXECUTE'),
              v_sig);
  end loop;
end $$;
