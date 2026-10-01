-- M1: the night lifecycle, with one lock order.
--
-- WHY
--   Starting, re-opening, finishing and ending a night were separate writes from
--   the host server actions, first to game_states and then to sessions, with no
--   lock between them. So a start could race an end and leave a running game in
--   a completed night, a game could be re-opened while another was running
--   (X10), a final-stage advance could leave a game half finished (X9), and the
--   public screens had no way to tell "before the first game" from "between
--   games" from "the night is over".
--
-- WHAT THIS ADDS
--   sessions.started_at     set once by start_game, when the first game starts.
--                           A re-open keeps it; reset_session_safe clears it.
--   sessions.completed_at   stamped by the trigger below when status becomes
--                           completed, cleared when it leaves completed. Only
--                           the transition stamps it, so a repeated end never
--                           overwrites it. Not backfilled: historic end times
--                           are unknown and nothing reads it to decide a phase.
--   sessions.state_version  bumped on every update, so the public screens can
--                           drop an older session snapshot (R09).
--
--   start_game, finish_game and end_night. Every one locks the SESSION row first
--   and then the game_states row, so any two lifecycle transitions on one night
--   run one after the other. No trigger on game_states writes to sessions,
--   because that would take the locks in the opposite order.
--
--   start_game also takes the cash jackpot amount for a 'jackpot' game, and
--   writes its Full House prize text ("£125 Cash Jackpot") in the same
--   transaction. games UPDATE is admin only in RLS, so a host could not save
--   that amount once the service-role client left startGame; this is the one
--   write to games a host can make, and only on a fresh start.
--
-- COMPATIBILITY
--   Additive. Today's host screen writes game_states and sessions directly, and
--   still can: nothing here revokes or guards those writes. The trigger stamps
--   those direct writes too.
--
-- ERROR KEYS (raised with errcode P0001, mapped in src/app/host/actions.ts)
--   unauthorized: ...        assert_is_host, the role guard
--   game_not_found           no such game
--   session_not_found        no such session
--   game_state_not_found     finish_game on a game that was never started
--   night_ended              start_game on a completed session
--   other_game_in_progress   start_game while another game of the night runs
--   invalid_sequence         p_number_sequence is not a permutation of 1 to 90,
--                            or a fresh start was given no sequence
--   not_controller           finish_game by a host who does not control it
--   not_in_progress          finish_game on a game that has not started
--   game_in_progress         end_night while a game is in progress
--   invalid_cash_jackpot     start_game given a cash jackpot amount that is not
--                            a positive, finite number of pounds with at most
--                            two decimal places
--   cash_jackpot_not_allowed start_game given a cash jackpot amount for a game
--                            that is not type 'jackpot', or for a re-open or a
--                            takeover rather than a fresh start
--   cash_jackpot_stage_count start_game given a cash jackpot amount for a
--                            jackpot game whose stage_sequence is not exactly
--                            one stage
--
-- IDEMPOTENT: yes. Columns use "if not exists", functions "create or replace"
-- (start_game drops its earlier two-argument signature first), the trigger is
-- dropped and recreated, and the backfill only fills nulls.
--
-- ROLLBACK: supabase/rollback/20261001000100_night_lifecycle.rollback.sql
-- restores the functions only. The columns and their data stay.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists state_version bigint not null default 0;

comment on column public.sessions.started_at is
  'When the first game of the night started. Set once by start_game; a re-open keeps it; reset_session_safe clears it. Backfilled from the earliest game start for nights before 2026-10-01.';

comment on column public.sessions.completed_at is
  'When the night was ended. Stamped by the sessions_lifecycle_stamp trigger on the transition to completed and cleared on the transition away from it. Null for nights completed before 2026-10-01: those end times were never recorded.';

comment on column public.sessions.state_version is
  'Bumped on every update by the sessions_lifecycle_stamp trigger. Public screens ignore a session snapshot older than the one they hold.';

-- ---------------------------------------------------------------------------
-- The stamp trigger
-- ---------------------------------------------------------------------------
-- Security invoker, like bump_game_state_version: it only edits NEW and reads
-- nothing, so it has no reason to run with more rights than the writer.
create or replace function public.sessions_lifecycle_stamp()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $function$
begin
  new.state_version := coalesce(old.state_version, 0) + 1;

  if new.status = 'completed'::public.session_status
     and old.status is distinct from 'completed'::public.session_status then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status is distinct from 'completed'::public.session_status
        and old.status = 'completed'::public.session_status then
    new.completed_at := null;
  end if;

  return new;
end;
$function$;

-- A trigger function is never called by a role, and firing a trigger does not
-- check EXECUTE. Same ACL as the other trigger functions: service_role only.
revoke all on function public.sessions_lifecycle_stamp() from public, anon, authenticated;
grant execute on function public.sessions_lifecycle_stamp() to service_role;

drop trigger if exists sessions_lifecycle_stamp on public.sessions;
create trigger sessions_lifecycle_stamp
before update on public.sessions
for each row execute function public.sessions_lifecycle_stamp();

-- ---------------------------------------------------------------------------
-- Backfill started_at from the earliest game start, only where it is null and
-- only where a game actually started, so a rerun writes nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rows int;
begin
  update public.sessions s
     set started_at = x.min_started
    from (
      select g.session_id, min(gs.started_at) as min_started
        from public.games g
        join public.game_states gs on gs.game_id = g.id
       where gs.started_at is not null
       group by g.session_id
    ) x
   where s.id = x.session_id
     and s.started_at is null;

  get diagnostics v_rows = row_count;
  raise notice 'night_lifecycle: backfilled sessions.started_at on % row(s)', v_rows;
end
$$;

-- ---------------------------------------------------------------------------
-- start_game
-- ---------------------------------------------------------------------------
-- One of three things, under the session lock then the game_states lock:
--   no state row, or a not_started one   a fresh start. The TypeScript side
--                                        still shuffles with crypto; this checks
--                                        it is a permutation of 1 to 90. A
--                                        not_started row keeps a sequence it
--                                        already holds, as startGame did.
--   completed                            a re-open: in_progress again, ended_at
--                                        cleared, pause, break and win cleared,
--                                        stage and board kept. The claim fields
--                                        clear with the pause (guard_claim_fields
--                                        from 20261001000200).
--   in_progress                          a takeover: the caller becomes the
--                                        controller. The heartbeat check stays
--                                        in startGame, as it is today.
-- Then the session is running, active_game_id points here, and started_at is
-- set if it is still null.
--
-- p_cash_jackpot_amount, in pounds, is for a fresh start of a 'jackpot' game
-- only. The host types it at the start, and it becomes the prize text of the
-- game's one stage (Full House), in the format formatCashJackpotPrize in
-- src/lib/jackpot.ts produced: "£125 Cash Jackpot", "£1,250.50 Cash Jackpot".
-- It is checked before anything is locked, and its applicability (a jackpot
-- game, a fresh start, one stage) under the game_states lock, so a game started
-- by another host in the meantime is refused rather than given a new prize.
-- Null leaves the prizes alone, which is every start that is not a fresh
-- jackpot start.
--
-- Adding the parameter makes a new function rather than replacing the old one,
-- and two overloads would make a two-argument call ambiguous, so the earlier
-- two-argument signature is dropped first.
drop function if exists public.start_game(uuid, integer[]);

create or replace function public.start_game(
  p_game_id uuid,
  p_number_sequence integer[] default null,
  p_cash_jackpot_amount numeric default null
)
returns public.game_states
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_game public.games;
  v_session public.sessions;
  v_state public.game_states;
  v_sequence jsonb;
  v_fresh boolean;
  v_jackpot_stage text;
  v_jackpot_pence numeric;
  v_jackpot_text text;
begin
  perform public.assert_is_host();

  select * into v_game from public.games where id = p_game_id;
  if v_game.id is null then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  -- The amount itself: positive, finite, whole pence. The text form catches
  -- NaN and Infinity, which numeric accepts and which compare oddly.
  if p_cash_jackpot_amount is not null then
    if p_cash_jackpot_amount::text in ('NaN', 'Infinity', '-Infinity')
       or p_cash_jackpot_amount <= 0
       or p_cash_jackpot_amount <> round(p_cash_jackpot_amount, 2) then
      raise exception 'invalid_cash_jackpot' using errcode = 'P0001';
    end if;

    if v_game.type is distinct from 'jackpot'::public.game_type then
      raise exception 'cash_jackpot_not_allowed' using errcode = 'P0001';
    end if;
  end if;

  -- Lock order: the session first, always.
  select * into v_session
    from public.sessions
   where id = v_game.session_id
   for update;

  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  if v_session.status = 'completed'::public.session_status then
    raise exception 'night_ended' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.game_states gs
      join public.games g on g.id = gs.game_id
     where g.session_id = v_session.id
       and gs.game_id <> p_game_id
       and gs.status = 'in_progress'::public.game_status
  ) then
    raise exception 'other_game_in_progress' using errcode = 'P0001';
  end if;

  if p_number_sequence is not null then
    if coalesce(array_length(p_number_sequence, 1), 0) <> 90
       or (select array_agg(n order by n) from unnest(p_number_sequence) n)
          is distinct from (select array_agg(g order by g) from generate_series(1, 90) g) then
      raise exception 'invalid_sequence' using errcode = 'P0001';
    end if;
    v_sequence := to_jsonb(p_number_sequence);
  end if;

  -- Then the game state.
  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  v_fresh := v_state.id is null
             or coalesce(v_state.status, 'not_started'::public.game_status) = 'not_started'::public.game_status;

  -- The cash jackpot prize, under both locks. A re-open or a takeover keeps the
  -- prize the night started with, so an amount there is refused, not ignored:
  -- the host typed it for a game that another host has started meanwhile.
  if p_cash_jackpot_amount is not null then
    if not v_fresh then
      raise exception 'cash_jackpot_not_allowed' using errcode = 'P0001';
    end if;

    -- One stage, and the amount belongs to it alone. Writing one amount over
    -- several stages is what once destroyed an admin's prizes; the admin
    -- screen forces a jackpot game to Full House only, so this only catches a
    -- game edited into an impossible shape.
    if jsonb_typeof(v_game.stage_sequence) is distinct from 'array'
       or jsonb_array_length(v_game.stage_sequence) <> 1
       or jsonb_typeof(v_game.stage_sequence -> 0) is distinct from 'string' then
      raise exception 'cash_jackpot_stage_count' using errcode = 'P0001';
    end if;
    v_jackpot_stage := v_game.stage_sequence ->> 0;

    -- formatCashJackpotPrize: pounds grouped in threes, pence only when there
    -- are some, always two digits.
    v_jackpot_pence := round(p_cash_jackpot_amount * 100);
    v_jackpot_text := '£'
      || regexp_replace(div(v_jackpot_pence, 100)::text, '(\d)(?=(\d{3})+$)', '\1,', 'g')
      || case when mod(v_jackpot_pence, 100) = 0 then ''
              else '.' || lpad(mod(v_jackpot_pence, 100)::text, 2, '0') end
      || ' Cash Jackpot';

    -- Merged onto the prizes as they stand under the row lock, so a stage key
    -- this does not name is never lost.
    update public.games
       set prizes = case when jsonb_typeof(prizes) = 'object' then prizes else '{}'::jsonb end
                    || jsonb_build_object(v_jackpot_stage, v_jackpot_text)
     where id = p_game_id;
  end if;

  if v_state.id is null then
    if v_sequence is null then
      raise exception 'invalid_sequence' using errcode = 'P0001';
    end if;

    -- The columns startGame inserted. call_delay_seconds takes the column
    -- default, which is DEFAULT_PUBLIC_CALL_DELAY_SECONDS (3).
    insert into public.game_states (
      game_id, number_sequence, called_numbers, numbers_called_count,
      current_stage_index, status, started_at, ended_at, last_call_at,
      on_break, paused_for_validation, display_win_type, display_win_text,
      display_winner_name, controlling_host_id, controller_last_seen_at
    ) values (
      p_game_id, v_sequence, '[]'::jsonb, 0,
      0, 'in_progress'::public.game_status, now(), null, null,
      false, false, null, null,
      null, v_uid, now()
    )
    returning * into v_state;

  elsif coalesce(v_state.status, 'not_started'::public.game_status) = 'not_started'::public.game_status then
    v_sequence := coalesce(v_state.number_sequence, v_sequence);
    if v_sequence is null then
      raise exception 'invalid_sequence' using errcode = 'P0001';
    end if;

    update public.game_states
       set number_sequence = v_sequence,
           called_numbers = '[]'::jsonb,
           numbers_called_count = 0,
           current_stage_index = 0,
           status = 'in_progress'::public.game_status,
           started_at = now(),
           ended_at = null,
           last_call_at = null,
           last_call_request_id = null,
           on_break = false,
           paused_for_validation = false,
           display_win_type = null,
           display_win_text = null,
           display_winner_name = null,
           controlling_host_id = v_uid,
           controller_last_seen_at = now()
     where game_id = p_game_id
    returning * into v_state;

  elsif v_state.status = 'completed'::public.game_status then
    update public.game_states
       set status = 'in_progress'::public.game_status,
           ended_at = null,
           on_break = false,
           paused_for_validation = false,
           display_win_type = null,
           display_win_text = null,
           display_winner_name = null,
           controlling_host_id = v_uid,
           controller_last_seen_at = now()
     where game_id = p_game_id
    returning * into v_state;

  else
    update public.game_states
       set controlling_host_id = v_uid,
           controller_last_seen_at = now()
     where game_id = p_game_id
    returning * into v_state;
  end if;

  -- Only write the session when something changes, so a takeover of the game
  -- already running does not bump the public session version for nothing.
  update public.sessions
     set status = 'running'::public.session_status,
         active_game_id = p_game_id,
         started_at = coalesce(started_at, now())
   where id = v_session.id
     and (status is distinct from 'running'::public.session_status
          or active_game_id is distinct from p_game_id
          or started_at is null);

  return v_state;
end;
$function$;

revoke all on function public.start_game(uuid, integer[], numeric) from public, anon;
grant execute on function public.start_game(uuid, integer[], numeric) to authenticated, service_role;

comment on function public.start_game(uuid, integer[], numeric) is
  'Starts, re-opens or takes over a game under the session lock then the game_states lock. Refuses night_ended and other_game_in_progress. On a fresh start of a jackpot game, p_cash_jackpot_amount (pounds, at most two decimals) becomes its one stage''s prize text, "£125 Cash Jackpot", in the same transaction; refuses invalid_cash_jackpot, cash_jackpot_not_allowed and cash_jackpot_stage_count. Host or admin; call with the cookie client, it records auth.uid() as the controller.';

-- ---------------------------------------------------------------------------
-- finish_game
-- ---------------------------------------------------------------------------
-- Idempotent: an already-completed game returns as it stands, before the
-- controller check, so a retry after a lost response cannot fail.
create or replace function public.finish_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_game public.games;
  v_session public.sessions;
  v_state public.game_states;
  v_all_done boolean;
begin
  perform public.assert_is_host();

  select * into v_game from public.games where id = p_game_id;
  if v_game.id is null then
    raise exception 'game_not_found' using errcode = 'P0001';
  end if;

  select * into v_session
    from public.sessions
   where id = v_game.session_id
   for update;

  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.id is null then
    raise exception 'game_state_not_found' using errcode = 'P0001';
  end if;

  if v_state.status = 'completed'::public.game_status then
    return jsonb_build_object(
      'game_state', to_jsonb(v_state),
      'session_completed', v_session.status = 'completed'::public.session_status
    );
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller' using errcode = 'P0001';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress' using errcode = 'P0001';
  end if;

  update public.game_states
     set status = 'completed'::public.game_status,
         ended_at = coalesce(ended_at, now()),
         on_break = false,
         paused_for_validation = false,
         display_win_type = null,
         display_win_text = null,
         display_winner_name = null
   where game_id = p_game_id
  returning * into v_state;

  -- A game with no state row has not been played, so it is not completed.
  select not exists (
    select 1
      from public.games g
      left join public.game_states gs on gs.game_id = g.id
     where g.session_id = v_session.id
       and coalesce(gs.status, 'not_started'::public.game_status) <> 'completed'::public.game_status
  ) into v_all_done;

  update public.sessions
     set active_game_id = case when active_game_id = p_game_id then null else active_game_id end,
         status = case when v_all_done then 'completed'::public.session_status else status end
   where id = v_session.id
     and (active_game_id = p_game_id
          or (v_all_done and status is distinct from 'completed'::public.session_status))
  returning * into v_session;

  if v_session.id is null then
    select * into v_session from public.sessions where id = v_game.session_id;
  end if;

  return jsonb_build_object(
    'game_state', to_jsonb(v_state),
    'session_completed', v_session.status = 'completed'::public.session_status
  );
end;
$function$;

revoke all on function public.finish_game(uuid) from public, anon;
grant execute on function public.finish_game(uuid) to authenticated, service_role;

comment on function public.finish_game(uuid) is
  'Completes a game under the session lock then the game_states lock, clears the pause, break and win, clears active_game_id if it points here, and completes the session when every game is completed. Returns {game_state, session_completed}. Idempotent. Snowball settlement stays a separate call after it.';

-- ---------------------------------------------------------------------------
-- end_night
-- ---------------------------------------------------------------------------
-- Idempotent: an already-completed night returns as it is, so the first
-- completed_at stands. Unplayed games stay not_started and their pot is not
-- touched.
create or replace function public.end_night(p_session_id uuid)
returns public.sessions
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_session public.sessions;
begin
  perform public.assert_is_host();

  select * into v_session
    from public.sessions
   where id = p_session_id
   for update;

  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  if v_session.status = 'completed'::public.session_status then
    return v_session;
  end if;

  if exists (
    select 1
      from public.game_states gs
      join public.games g on g.id = gs.game_id
     where g.session_id = p_session_id
       and gs.status = 'in_progress'::public.game_status
  ) then
    raise exception 'game_in_progress' using errcode = 'P0001';
  end if;

  update public.sessions
     set status = 'completed'::public.session_status,
         active_game_id = null
   where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$function$;

revoke all on function public.end_night(uuid) from public, anon;
grant execute on function public.end_night(uuid) to authenticated, service_role;

comment on function public.end_night(uuid) is
  'Ends the night under the session lock. Refuses game_in_progress. Idempotent: an already-completed night is returned unchanged, keeping its first completed_at.';

-- ---------------------------------------------------------------------------
-- reset_session_safe: the body from 20260825080604, with started_at cleared in
-- the final update. The trigger clears completed_at as the status leaves
-- completed. It already locks the session first.
-- ---------------------------------------------------------------------------
create or replace function public.reset_session_safe(p_session_id uuid)
returns public.session_reset_log
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_session public.sessions;
  v_settled_pot_name text;
  v_winners jsonb;
  v_winner_count int;
  v_state_count int;
  v_log public.session_reset_log;
begin
  perform public.assert_is_admin();

  select * into v_session
    from public.sessions
   where id = p_session_id
   for update;

  if v_session.id is null then
    raise exception 'session_not_found';
  end if;

  -- Refuse if any game in this session has already settled the pot. Resetting
  -- would leave the claim in place and the pot where this night put it, and the
  -- replayed night could then never move the pot again.
  select p.name into v_settled_pot_name
    from public.snowball_pot_history h
    join public.games g on g.id = h.game_id
    join public.snowball_pots p on p.id = h.snowball_pot_id
   where g.session_id = p_session_id
   limit 1;

  if v_settled_pot_name is not null then
    raise exception 'snowball_already_settled:%', v_settled_pot_name;
  end if;

  -- Snapshot before deleting. jsonb_agg over zero rows is null, which is the
  -- right answer for "this session had no winners".
  select jsonb_agg(to_jsonb(w) order by w.created_at), count(*)
    into v_winners, v_winner_count
    from public.winners w
   where w.session_id = p_session_id;

  select count(*) into v_state_count
    from public.game_states gs
    join public.games g on g.id = gs.game_id
   where g.session_id = p_session_id;

  insert into public.session_reset_log (
    session_id, session_name, reset_by,
    winners_deleted, game_states_deleted, winners_snapshot
  ) values (
    p_session_id, v_session.name, auth.uid(),
    coalesce(v_winner_count, 0), coalesce(v_state_count, 0), v_winners
  )
  returning * into v_log;

  delete from public.winners where session_id = p_session_id;

  delete from public.game_states gs
   using public.games g
   where gs.game_id = g.id and g.session_id = p_session_id;

  update public.sessions
     set status = 'ready', active_game_id = null, started_at = null
   where id = p_session_id;

  return v_log;
end;
$function$;

revoke all on function public.reset_session_safe(uuid) from public, anon;
grant execute on function public.reset_session_safe(uuid) to authenticated, service_role;

comment on function public.reset_session_safe(uuid) is
  'Wipes a session back to ready and clears started_at (the trigger clears completed_at). Admin only. Records everything it destroys in session_reset_log first, and refuses outright when the session has already settled a snowball pot, because the pot cannot be safely rewound.';
