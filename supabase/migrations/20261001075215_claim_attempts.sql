-- M2a: claim attempts, live drafts and server verdicts. Additive.
--
-- WHY
--   A claim check lived only on the host's phone. The TV showed "Checking
--   Claim" and nothing else, the verdict came from a server action that read the
--   board once, duplicates were accepted (X16), the host could undo a ball in the
--   middle of a check (X17), and a reload or a takeover lost the check entirely.
--   The owner decided (D1) the room sees each claimed number as the host taps
--   it, then the server's verdict.
--
-- THE MODEL
--   One claim attempt per claimant, a uuid minted by the host's phone. It is
--   stored when the check starts and binds every draft, the verdict, the one
--   permitted undo and, from M2b, the recorded winner (it IS the winner's
--   idempotency key, record_winner_atomic's p_client_request_id).
--
--   Private columns on game_states:
--     claim_attempt_id    the attempt being checked
--     claim_stage_index   the stage when the check started (a stage change makes
--                         the attempt stale)
--     claim_call_count    the ball count when the check started, moved down by
--                         the bound undo
--     claim_draft_seq     the highest draft sequence stored; lower ones are
--                         ignored, so an out-of-order write cannot win
--     claim_undo_used     the one undo this attempt may make has been made
--   Public columns, on game_states and mirrored to game_states_public:
--     claim_numbers       the claimed numbers in the order tapped
--     claim_result        'valid', 'invalid' or 'late'; null until checked
--
-- PROTECTION
--   guard_claim_fields(), before insert or update on game_states. When the game
--   is not paused for validation it clears every claim field, which covers
--   resume, break, advance, skip, finish and restart in one place. When it is
--   paused, any change to a claim field is refused unless the transaction-local
--   setting bingo.claim_write is 'on', which only the functions below set.
--   Staff can still update the other game_states columns directly (accepted
--   limitation, spec section 9); they can no longer forge a claim or a verdict.
--
-- COMPATIBILITY
--   record_winner_atomic is NOT changed here, so today's host screen still
--   records winners exactly as before. Its direct writes (pause, resume, break,
--   announce) never touch a claim field, so the guard lets them through.
--   void_last_number gains two parameters with defaults; the one-argument
--   version is dropped so void_last_number({p_game_id}) still resolves to
--   exactly one function. Unpaused it is unchanged. Paused, it now needs the
--   attempt (X17); today's host screen already disables Undo while paused.
--
-- RETURN SHAPE of begin_claim_check, set_claim_draft and check_claim (jsonb):
--   ok               false when the call was refused and wrote nothing
--   code             the outcome, listed per function below
--   attempt_id       the attempt on the row after the call (on attempt_mismatch,
--                    the attempt the caller should adopt)
--   claim_numbers    the stored numbers, tap order, or null
--   claim_result     the stored verdict, or null
--   claim_draft_seq  the stored draft sequence; a client adopting an attempt
--                    continues its sequence from here
--   game_state       the whole game_states row
--   check_claim adds invalid_numbers (uncalled numbers, tap order) and
--   last_number (the last ball called).
--
-- RAISED ERROR KEYS (errcode P0001, mapped in HOST_RPC_ERRORS)
--   unauthorized: ...     assert_is_host
--   attempt_required      a null p_attempt_id
--   game_state_not_found  game_not_found  not_controller  not_in_progress
--   on_break              begin_claim_check during a break
--   unknown_stage         the game has no stage at current_stage_index
--   void_last_number, paused: paused_for_validation (no attempt given),
--   attempt_mismatch, verdict_already_given, already_undone, plus its existing
--   nothing_to_void and winner_on_ball.
--   claim_fields_protected   the guard refusing a direct write of a claim field
--
-- IDEMPOTENT: yes. Columns "if not exists", the check constraint guarded,
-- functions "create or replace", triggers dropped and recreated.
--
-- ROLLBACK: supabase/rollback/20261001000200_claim_attempts.rollback.sql
-- restores the functions only. The columns and their data stay.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.game_states
  add column if not exists claim_attempt_id uuid,
  add column if not exists claim_stage_index integer,
  add column if not exists claim_call_count integer,
  add column if not exists claim_draft_seq integer not null default 0,
  add column if not exists claim_undo_used boolean not null default false,
  add column if not exists claim_numbers jsonb,
  add column if not exists claim_result text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'game_states_claim_result_check'
       and conrelid = 'public.game_states'::regclass
  ) then
    alter table public.game_states
      add constraint game_states_claim_result_check
      check (claim_result in ('valid', 'invalid', 'late'));
  end if;
end
$$;

alter table public.game_states_public
  add column if not exists claim_numbers jsonb,
  add column if not exists claim_result text;

comment on column public.game_states.claim_attempt_id is
  'The claim attempt being checked, minted by the host phone. Binds drafts, the verdict, the one undo and (from M2b) the recorded winner. Cleared whenever the game is not paused for validation.';
comment on column public.game_states.claim_numbers is
  'The claimed numbers in tap order. Public (mirrored). Writable only by the claim functions while paused.';
comment on column public.game_states.claim_result is
  'The server verdict for the attempt: valid, invalid or late. Public (mirrored). Null until check_claim gives one.';
comment on column public.game_states_public.claim_numbers is
  'Mirror of game_states.claim_numbers: what the TV and phones show while a claim is checked.';
comment on column public.game_states_public.claim_result is
  'Mirror of game_states.claim_result.';

-- ---------------------------------------------------------------------------
-- The public mirror carries the two public claim columns. create or replace
-- resets the SET clause, so search_path is restated, and the ACL is restated
-- to what 20260527080524 and 20260929103018 left.
-- ---------------------------------------------------------------------------
create or replace function public.sync_game_states_public()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if (tg_op = 'DELETE') then
    delete from public.game_states_public where game_id = old.game_id;
    return old;
  end if;

  insert into public.game_states_public (
    game_id,
    called_numbers,
    numbers_called_count,
    current_stage_index,
    status,
    call_delay_seconds,
    on_break,
    paused_for_validation,
    display_win_type,
    display_win_text,
    display_winner_name,
    started_at,
    ended_at,
    last_call_at,
    updated_at,
    state_version,
    claim_numbers,
    claim_result
  ) values (
    new.game_id,
    new.called_numbers,
    new.numbers_called_count,
    new.current_stage_index,
    new.status,
    new.call_delay_seconds,
    new.on_break,
    new.paused_for_validation,
    new.display_win_type,
    new.display_win_text,
    new.display_winner_name,
    new.started_at,
    new.ended_at,
    new.last_call_at,
    new.updated_at,
    new.state_version,
    new.claim_numbers,
    new.claim_result
  )
  on conflict (game_id) do update set
    called_numbers = excluded.called_numbers,
    numbers_called_count = excluded.numbers_called_count,
    current_stage_index = excluded.current_stage_index,
    status = excluded.status,
    call_delay_seconds = excluded.call_delay_seconds,
    on_break = excluded.on_break,
    paused_for_validation = excluded.paused_for_validation,
    display_win_type = excluded.display_win_type,
    display_win_text = excluded.display_win_text,
    display_winner_name = excluded.display_winner_name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    last_call_at = excluded.last_call_at,
    updated_at = excluded.updated_at,
    state_version = excluded.state_version,
    claim_numbers = excluded.claim_numbers,
    claim_result = excluded.claim_result;

  return new;
end;
$function$;

revoke all on function public.sync_game_states_public() from public, anon, authenticated;
grant execute on function public.sync_game_states_public() to service_role;

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------
-- Security invoker: it only edits NEW and reads a setting. Named so it sorts
-- after bump_game_state_version; both are before-row triggers and both run.
create or replace function public.guard_claim_fields()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $function$
begin
  if coalesce(new.paused_for_validation, false) = false then
    new.claim_attempt_id := null;
    new.claim_stage_index := null;
    new.claim_call_count := null;
    new.claim_draft_seq := 0;
    new.claim_undo_used := false;
    new.claim_numbers := null;
    new.claim_result := null;
    return new;
  end if;

  if current_setting('bingo.claim_write', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      if new.claim_attempt_id is not null
         or new.claim_stage_index is not null
         or new.claim_call_count is not null
         or coalesce(new.claim_draft_seq, 0) <> 0
         or coalesce(new.claim_undo_used, false)
         or new.claim_numbers is not null
         or new.claim_result is not null then
        raise exception 'claim_fields_protected' using errcode = 'P0001';
      end if;
    elsif new.claim_attempt_id is distinct from old.claim_attempt_id
       or new.claim_stage_index is distinct from old.claim_stage_index
       or new.claim_call_count is distinct from old.claim_call_count
       or new.claim_draft_seq is distinct from old.claim_draft_seq
       or new.claim_undo_used is distinct from old.claim_undo_used
       or new.claim_numbers is distinct from old.claim_numbers
       or new.claim_result is distinct from old.claim_result then
      raise exception 'claim_fields_protected' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_claim_fields() from public, anon, authenticated;
grant execute on function public.guard_claim_fields() to service_role;

drop trigger if exists guard_claim_fields on public.game_states;
create trigger guard_claim_fields
before insert or update on public.game_states
for each row execute function public.guard_claim_fields();

-- ---------------------------------------------------------------------------
-- How many numbers each stage needs. MUST equal
-- REQUIRED_SELECTION_COUNT_BY_STAGE in src/lib/win-stages.ts; claims.test.sql
-- and supabase/tests/claim-stage-counts.test.ts enforce it.
-- ---------------------------------------------------------------------------
create or replace function public.required_claim_count(p_stage text)
returns integer
language sql
immutable
set search_path = public, pg_catalog
as $function$
  select case p_stage
           when 'Line' then 5
           when 'Two Lines' then 10
           when 'Full House' then 15
         end
$function$;

revoke all on function public.required_claim_count(text) from public, anon;
grant execute on function public.required_claim_count(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- begin_claim_check
--   codes: started         a check began (or a pause with no attempt adopted it)
--          already_started the same attempt again: a safe retry, nothing written
--          replaced        p_new_claimant replaced a different attempt
--          attempt_mismatch (ok false) another attempt is being checked; adopt
--                          the returned attempt_id and its draft
-- Replaces pauseForValidation.
-- ---------------------------------------------------------------------------
create or replace function public.begin_claim_check(
  p_game_id uuid,
  p_attempt_id uuid,
  p_new_claimant boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state public.game_states;
  v_code text;
begin
  perform public.assert_is_host();

  if p_attempt_id is null then
    raise exception 'attempt_required' using errcode = 'P0001';
  end if;

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.id is null then
    raise exception 'game_state_not_found' using errcode = 'P0001';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller' using errcode = 'P0001';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress' using errcode = 'P0001';
  end if;

  if coalesce(v_state.on_break, false) then
    raise exception 'on_break' using errcode = 'P0001';
  end if;

  if coalesce(v_state.paused_for_validation, false)
     and v_state.claim_attempt_id = p_attempt_id then
    v_code := 'already_started';
  elsif coalesce(v_state.paused_for_validation, false)
        and v_state.claim_attempt_id is not null
        and not coalesce(p_new_claimant, false) then
    return jsonb_build_object(
      'ok', false, 'code', 'attempt_mismatch',
      'attempt_id', v_state.claim_attempt_id,
      'claim_numbers', v_state.claim_numbers,
      'claim_result', v_state.claim_result,
      'claim_draft_seq', v_state.claim_draft_seq,
      'game_state', to_jsonb(v_state));
  else
    v_code := case
                when coalesce(v_state.paused_for_validation, false)
                     and v_state.claim_attempt_id is not null then 'replaced'
                else 'started'
              end;

    perform set_config('bingo.claim_write', 'on', true);

    update public.game_states
       set paused_for_validation = true,
           display_win_type = null,
           display_win_text = null,
           display_winner_name = null,
           claim_attempt_id = p_attempt_id,
           claim_stage_index = coalesce(current_stage_index, 0),
           claim_call_count = coalesce(numbers_called_count, 0),
           claim_draft_seq = 0,
           claim_undo_used = false,
           claim_numbers = '[]'::jsonb,
           claim_result = null
     where game_id = p_game_id
    returning * into v_state;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', v_code,
    'attempt_id', v_state.claim_attempt_id,
    'claim_numbers', v_state.claim_numbers,
    'claim_result', v_state.claim_result,
    'claim_draft_seq', v_state.claim_draft_seq,
    'game_state', to_jsonb(v_state));
end;
$function$;

revoke all on function public.begin_claim_check(uuid, uuid, boolean) from public, anon;
grant execute on function public.begin_claim_check(uuid, uuid, boolean) to authenticated, service_role;

comment on function public.begin_claim_check(uuid, uuid, boolean) is
  'Starts a claim check for an attempt: pauses, clears the win fields, stores the attempt and its snapshots. Same attempt: a no-op. Different attempt: attempt_mismatch (adopt it), or replace it with p_new_claimant. Host or admin, controller only.';

-- ---------------------------------------------------------------------------
-- set_claim_draft
--   codes: saved            stored
--          stale_seq        p_seq not above the stored sequence: ignored, the
--                           current draft returned unchanged (ok true)
--   refusals (ok false): not_paused, attempt_mismatch, verdict_already_given,
--          stale_attempt, number_out_of_range, duplicate_numbers,
--          too_many_numbers
-- ---------------------------------------------------------------------------
create or replace function public.set_claim_draft(
  p_game_id uuid,
  p_attempt_id uuid,
  p_numbers integer[],
  p_seq integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state public.game_states;
  v_numbers integer[] := coalesce(p_numbers, '{}'::integer[]);
  v_required integer;
  v_code text;
begin
  perform public.assert_is_host();

  if p_attempt_id is null then
    raise exception 'attempt_required' using errcode = 'P0001';
  end if;

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.id is null then
    raise exception 'game_state_not_found' using errcode = 'P0001';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller' using errcode = 'P0001';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress' using errcode = 'P0001';
  end if;

  if not coalesce(v_state.paused_for_validation, false) then
    v_code := 'not_paused';
  elsif v_state.claim_attempt_id is distinct from p_attempt_id then
    v_code := 'attempt_mismatch';
  elsif v_state.claim_result is not null then
    v_code := 'verdict_already_given';
  elsif v_state.claim_stage_index is distinct from v_state.current_stage_index then
    v_code := 'stale_attempt';
  elsif exists (select 1 from unnest(v_numbers) n where n is null or n < 1 or n > 90) then
    v_code := 'number_out_of_range';
  elsif cardinality(v_numbers) <> (select count(distinct n) from unnest(v_numbers) n) then
    v_code := 'duplicate_numbers';
  end if;

  if v_code is null then
    select public.required_claim_count(g.stage_sequence ->> coalesce(v_state.current_stage_index, 0))
      into v_required
      from public.games g
     where g.id = p_game_id;

    if v_required is null then
      raise exception 'unknown_stage' using errcode = 'P0001';
    end if;

    if cardinality(v_numbers) > v_required then
      v_code := 'too_many_numbers';
    end if;
  end if;

  if v_code is not null then
    return jsonb_build_object(
      'ok', false, 'code', v_code,
      'attempt_id', v_state.claim_attempt_id,
      'claim_numbers', v_state.claim_numbers,
      'claim_result', v_state.claim_result,
      'claim_draft_seq', v_state.claim_draft_seq,
      'game_state', to_jsonb(v_state));
  end if;

  if p_seq is null or p_seq <= v_state.claim_draft_seq then
    v_code := 'stale_seq';
  else
    perform set_config('bingo.claim_write', 'on', true);

    update public.game_states
       set claim_numbers = to_jsonb(v_numbers),
           claim_draft_seq = p_seq
     where game_id = p_game_id
    returning * into v_state;

    v_code := 'saved';
  end if;

  return jsonb_build_object(
    'ok', true, 'code', v_code,
    'attempt_id', v_state.claim_attempt_id,
    'claim_numbers', v_state.claim_numbers,
    'claim_result', v_state.claim_result,
    'claim_draft_seq', v_state.claim_draft_seq,
    'game_state', to_jsonb(v_state));
end;
$function$;

revoke all on function public.set_claim_draft(uuid, uuid, integer[], integer) from public, anon;
grant execute on function public.set_claim_draft(uuid, uuid, integer[], integer) to authenticated, service_role;

comment on function public.set_claim_draft(uuid, uuid, integer[], integer) is
  'Stores the live draft of a claim, in tap order, for the TV and phones. Only while paused, for the current attempt, before a verdict. A sequence not above the stored one is ignored. Host or admin, controller only.';

-- ---------------------------------------------------------------------------
-- check_claim
--   verdict codes (ok true): valid, invalid, late
--          missing_last_ball  every number was called but the last ball is
--                             not in the claim: the numbers are stored as the
--                             draft, no verdict is written, and the host
--                             decides (A1): the bound undo then check again,
--                             or check again with p_reject_as_late
--   A retry once a verdict exists returns it (ok true, code = the verdict) when
--   the numbers match, in any order.
--   refusals (ok false): not_paused, attempt_mismatch, stale_attempt,
--          verdict_already_given (a verdict exists and the numbers differ),
--          number_out_of_range, duplicate_numbers, wrong_count
-- ---------------------------------------------------------------------------
create or replace function public.check_claim(
  p_game_id uuid,
  p_attempt_id uuid,
  p_numbers integer[],
  p_reject_as_late boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state public.game_states;
  v_numbers integer[] := coalesce(p_numbers, '{}'::integer[]);
  v_called integer[];
  v_count integer;
  v_last integer;
  v_required integer;
  v_invalid integer[];
  v_code text;
  v_ok boolean := true;
begin
  perform public.assert_is_host();

  if p_attempt_id is null then
    raise exception 'attempt_required' using errcode = 'P0001';
  end if;

  select * into v_state
    from public.game_states
   where game_id = p_game_id
   for update;

  if v_state.id is null then
    raise exception 'game_state_not_found' using errcode = 'P0001';
  end if;

  if v_state.controlling_host_id is null
     or v_state.controlling_host_id <> auth.uid() then
    raise exception 'not_controller' using errcode = 'P0001';
  end if;

  if coalesce(v_state.status, 'not_started'::public.game_status)
     <> 'in_progress'::public.game_status then
    raise exception 'not_in_progress' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(e.value::integer order by e.ordinality), '{}'::integer[])
    into v_called
    from jsonb_array_elements_text(
           case when jsonb_typeof(v_state.called_numbers) = 'array'
                then v_state.called_numbers else '[]'::jsonb end
         ) with ordinality as e(value, ordinality);

  v_count := coalesce(v_state.numbers_called_count, 0);
  v_last := case when v_count > 0 then v_called[v_count] end;

  if not coalesce(v_state.paused_for_validation, false) then
    v_ok := false; v_code := 'not_paused';
  elsif v_state.claim_attempt_id is distinct from p_attempt_id then
    v_ok := false; v_code := 'attempt_mismatch';
  elsif v_state.claim_stage_index is distinct from v_state.current_stage_index then
    v_ok := false; v_code := 'stale_attempt';
  elsif v_state.claim_result is not null then
    -- A verdict already exists for this attempt. The same numbers are a retry
    -- of a check whose response was lost; different numbers are not.
    if (select array_agg(n order by n) from unnest(v_numbers) n)
       is not distinct from
       (select array_agg(x::integer order by x::integer)
          from jsonb_array_elements_text(v_state.claim_numbers) x) then
      v_code := v_state.claim_result;
    else
      v_ok := false; v_code := 'verdict_already_given';
    end if;
  elsif exists (select 1 from unnest(v_numbers) n where n is null or n < 1 or n > 90) then
    v_ok := false; v_code := 'number_out_of_range';
  elsif cardinality(v_numbers) <> (select count(distinct n) from unnest(v_numbers) n) then
    v_ok := false; v_code := 'duplicate_numbers';
  else
    select public.required_claim_count(g.stage_sequence ->> coalesce(v_state.current_stage_index, 0))
      into v_required
      from public.games g
     where g.id = p_game_id;

    if v_required is null then
      raise exception 'unknown_stage' using errcode = 'P0001';
    end if;

    if cardinality(v_numbers) <> v_required then
      v_ok := false; v_code := 'wrong_count';
    else
      select coalesce(array_agg(n order by o), '{}'::integer[]) into v_invalid
        from unnest(v_numbers) with ordinality as u(n, o)
       where not (n = any (v_called));

      if cardinality(v_invalid) > 0 then
        v_code := 'invalid';
      elsif v_last is null or not (v_last = any (v_numbers)) then
        v_code := case when coalesce(p_reject_as_late, false) then 'late' else 'missing_last_ball' end;
      else
        v_code := 'valid';
      end if;

      perform set_config('bingo.claim_write', 'on', true);

      update public.game_states
         set claim_numbers = to_jsonb(v_numbers),
             claim_result = case when v_code = 'missing_last_ball' then null else v_code end
       where game_id = p_game_id
      returning * into v_state;
    end if;
  end if;

  -- Reported from what is stored, so a retry answers exactly as the first call.
  select coalesce(array_agg(x::integer order by o), '{}'::integer[]) into v_invalid
    from jsonb_array_elements_text(coalesce(v_state.claim_numbers, '[]'::jsonb))
         with ordinality as u(x, o)
   where not (x::integer = any (v_called));

  return jsonb_build_object(
    'ok', v_ok, 'code', v_code,
    'attempt_id', v_state.claim_attempt_id,
    'claim_numbers', v_state.claim_numbers,
    'claim_result', v_state.claim_result,
    'claim_draft_seq', v_state.claim_draft_seq,
    'invalid_numbers', to_jsonb(v_invalid),
    'last_number', v_last,
    'game_state', to_jsonb(v_state));
end;
$function$;

revoke all on function public.check_claim(uuid, uuid, integer[], boolean) from public, anon;
grant execute on function public.check_claim(uuid, uuid, integer[], boolean) to authenticated, service_role;

comment on function public.check_claim(uuid, uuid, integer[], boolean) is
  'Gives the server verdict on a claim: invalid (a number not called), missing_last_ball (host decides) or late, else valid. Idempotent per attempt. Host or admin, controller only.';

-- ---------------------------------------------------------------------------
-- void_last_number. Unpaused: the body from 20260825080606, unchanged. Paused:
-- the one undo a claim attempt may make, bound to the attempt and to the ball
-- count the host saw, so a repeated tap refuses with already_undone instead of
-- removing a second ball.
-- ---------------------------------------------------------------------------
drop function if exists public.void_last_number(uuid);

create or replace function public.void_last_number(
  p_game_id uuid,
  p_attempt_id uuid default null,
  p_expected_count integer default null
)
returns public.game_states
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state public.game_states;
  v_count int;
  v_length int;
  v_winners int;
  v_paused boolean;
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

  v_paused := coalesce(v_state.paused_for_validation, false);

  if v_paused then
    if p_attempt_id is null then
      raise exception 'paused_for_validation' using errcode = 'P0001';
    end if;
    if v_state.claim_attempt_id is distinct from p_attempt_id then
      raise exception 'attempt_mismatch' using errcode = 'P0001';
    end if;
    if v_state.claim_result is not null then
      raise exception 'verdict_already_given' using errcode = 'P0001';
    end if;
    if v_state.claim_undo_used
       or v_state.numbers_called_count is distinct from p_expected_count then
      raise exception 'already_undone' using errcode = 'P0001';
    end if;
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

  if v_paused then
    perform set_config('bingo.claim_write', 'on', true);

    update public.game_states
       set called_numbers = coalesce(called_numbers, '[]'::jsonb) - (v_length - 1),
           numbers_called_count = coalesce(numbers_called_count, 0) - 1,
           display_win_type = null,
           display_win_text = null,
           display_winner_name = null,
           last_call_request_id = null,
           claim_undo_used = true,
           claim_call_count = coalesce(numbers_called_count, 0) - 1
     where game_id = p_game_id
     returning * into v_state;
  else
    update public.game_states
       set called_numbers = coalesce(called_numbers, '[]'::jsonb) - (v_length - 1),
           numbers_called_count = coalesce(numbers_called_count, 0) - 1,
           display_win_type = null,
           display_win_text = null,
           display_winner_name = null,
           last_call_request_id = null
     where game_id = p_game_id
     returning * into v_state;
  end if;

  return v_state;
end;
$function$;

revoke all on function public.void_last_number(uuid, uuid, integer) from public, anon;
grant execute on function public.void_last_number(uuid, uuid, integer) to authenticated, service_role;

comment on function public.void_last_number(uuid, uuid, integer) is
  'Undoes the last ball. Unpaused: as before. Paused for a claim: only for the current attempt, before a verdict, once per attempt, and only when numbers_called_count equals p_expected_count, so a repeated tap refuses with already_undone.';
