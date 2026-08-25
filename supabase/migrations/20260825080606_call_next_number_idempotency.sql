-- Calling a ball becomes safe to retry.
--
-- WHY
--   call_next_number had no idempotency key, while the host client's own error
--   copy told the host to try again:
--
--     "Could not reach the server. Check the connection and tap again."
--
--   A call that committed and lost its response therefore drew a SECOND ball on
--   the retry. Two balls out of the bag, one of them never announced to the
--   room, and the display revealing a number the host never said. On a 90-ball
--   game where every ball is a chance at a jackpot inside a call window, that is
--   not cosmetic.
--
--   Every other mutation had already been made safe: recordWinner keys on
--   client_request_id, advanceToNextStage and skipStage bind to a client-named
--   expected stage index. This was the last one, and it was the most frequently
--   pressed button in the app.
--
-- HOW
--   The client mints a key when the host taps and holds it until a response
--   arrives, so the tap and every retry of that tap carry the same key. The key
--   is stored on the row inside the same transaction and under the same lock as
--   the draw, which is the only thing that makes it work: a key the database
--   does not persist and compare under the lock is decoration.
--
--   The important case is the one that needs no special handling. If the first
--   attempt never committed, last_call_request_id was never written, the retry
--   does not match, and it draws normally. If the first attempt did commit, the
--   retry matches and returns the state as it stands without drawing. Both are
--   correct, and neither needs the client to know which happened.
--
-- WHY THE OLD SIGNATURE IS DROPPED
--   The new argument has a default, so leaving the two-argument version in place
--   would make a two-argument call ambiguous and Postgres would refuse it at
--   runtime. This is the same overload trap that winner_idempotency_key had to
--   handle when record_winner_atomic went from seven arguments to eight.
--
-- DEPLOY ORDER
--   Application first or together. The old client calls with two named
--   arguments, which the new function accepts because the third defaults to
--   null, and a null key simply means "not idempotent", which is exactly the
--   behaviour it has today. So the old client keeps working against the new
--   function, and there is no window where anything is worse than it was.
--
-- ROLLBACK
--   drop function public.call_next_number(uuid, integer, uuid);
--   then recreate the two-argument version from
--   20260729231945_atomic_host_mutations.sql. The column can stay.

alter table public.game_states
  add column if not exists last_call_request_id uuid;

comment on column public.game_states.last_call_request_id is
  'Idempotency key of the most recent successful call_next_number. A retry carrying the same key returns the state unchanged instead of drawing a second ball. Deliberately not mirrored into game_states_public: it is a host concern and no public surface reads it.';

drop function if exists public.call_next_number(uuid, integer);

create or replace function public.call_next_number(
  p_game_id uuid,
  p_min_gap_ms integer default 400,
  p_client_request_id uuid default null
)
returns public.game_states
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state public.game_states;
  v_count int;
  v_next int;
  v_remaining_ms numeric;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  -- Idempotency first, before every other precheck, for the same reason
  -- record_winner_atomic does it: if this exact tap is already on record then
  -- the draw happened, and re-asserting the prechecks could only invent a
  -- failure for a ball that is already on the board. In particular the
  -- anti-double-tap gap would refuse the retry, which is precisely backwards.
  if p_client_request_id is not null
     and v_state.last_call_request_id = p_client_request_id then
    return v_state;
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress';
  end if;

  if coalesce(v_state.on_break, false) then
    raise exception 'on_break';
  end if;

  if coalesce(v_state.paused_for_validation, false) then
    raise exception 'paused_for_validation';
  end if;

  v_count := coalesce(v_state.numbers_called_count, 0);

  if v_state.number_sequence is null
     or jsonb_typeof(v_state.number_sequence) <> 'array'
     or v_count >= jsonb_array_length(v_state.number_sequence) then
    raise exception 'no_more_numbers';
  end if;

  if v_state.last_call_at is not null and v_count > 0 then
    v_remaining_ms := coalesce(p_min_gap_ms, 0)
      - (extract(epoch from (now() - v_state.last_call_at)) * 1000);
    if v_remaining_ms > 0 then
      raise exception 'too_soon:%', ceil(v_remaining_ms)::bigint;
    end if;
  end if;

  v_next := (v_state.number_sequence -> v_count)::int;

  update public.game_states
     set called_numbers = coalesce(called_numbers, '[]'::jsonb) || to_jsonb(v_next),
         numbers_called_count = coalesce(numbers_called_count, 0) + 1,
         last_call_at = now(),
         last_call_request_id = p_client_request_id
   where game_id = p_game_id
   returning * into v_state;

  return v_state;
end;
$function$;

-- Recreating the function rebuilds its ACL from the schema default privileges,
-- which grant EXECUTE to anon. Both revokes are required, as documented in
-- 20260730070705_revoke_anon_execute_on_host_rpcs.sql.
revoke all on function public.call_next_number(uuid, integer, uuid) from public;
revoke all on function public.call_next_number(uuid, integer, uuid) from anon;
grant execute on function public.call_next_number(uuid, integer, uuid) to authenticated, service_role;

comment on function public.call_next_number(uuid, integer, uuid) is
  'Draws the next ball under a row lock, with every precheck inside the lock. Idempotent on p_client_request_id: a retry carrying the key of a call that already committed returns the state unchanged rather than drawing a second ball.';

-- void_last_number must clear the key it is undoing.
--
-- The body below is the LIVE production definition, verbatim, with exactly one
-- line added: `last_call_request_id = null` in the update. It was fetched with
-- pg_get_functiondef rather than reconstructed, because a rewrite from memory of
-- what it "should" do dropped the in_progress check, the separate array-length
-- calculation and the display_win_* clearing, any one of which would have been a
-- live-game regression introduced by a migration meant to fix one.
--
-- Why the line is needed: without it, a voided ball leaves the key of the call
-- that drew it on the row, so a subsequent call carrying that same key would be
-- treated as a retry and refuse to re-draw. The client mints a new key per tap
-- so this cannot happen in practice, but a stale key on a row whose call has
-- been undone is a trap for whoever reads this next.
create or replace function public.void_last_number(p_game_id uuid)
returns public.game_states
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state public.game_states;
  v_count int;
  v_length int;
  v_winners int;
begin
  perform public.assert_is_host();

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.game_id is null then
    raise exception 'game_state_not_found';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress';
  end if;

  v_count := coalesce(v_state.numbers_called_count, 0);

  if v_state.called_numbers is null
     or jsonb_typeof(v_state.called_numbers) <> 'array' then
    v_length := 0;
  else
    v_length := jsonb_array_length(v_state.called_numbers);
  end if;

  if v_count = 0 or v_length = 0 then
    raise exception 'nothing_to_void';
  end if;

  select count(*) into v_winners
    from public.winners
   where game_id = p_game_id
     and call_count_at_win = v_count
     and coalesce(is_void, false) = false;

  if v_winners > 0 then
    raise exception 'winner_on_ball';
  end if;

  update public.game_states
     set called_numbers = coalesce(called_numbers, '[]'::jsonb) - (v_length - 1),
         numbers_called_count = coalesce(numbers_called_count, 0) - 1,
         display_win_type = null,
         display_win_text = null,
         display_winner_name = null,
         last_call_request_id = null
   where game_id = p_game_id
   returning * into v_state;

  return v_state;
end;
$function$;

revoke all on function public.void_last_number(uuid) from public;
revoke all on function public.void_last_number(uuid) from anon;
grant execute on function public.void_last_number(uuid) to authenticated, service_role;
