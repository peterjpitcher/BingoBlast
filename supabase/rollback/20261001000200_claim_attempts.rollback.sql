-- Rollback for 20261001000200_claim_attempts.sql (M2a). Function definitions
-- only.
--
-- WHAT IT DOES
--   Drops guard_claim_fields (trigger and function), begin_claim_check,
--   set_claim_draft, check_claim and required_claim_count. Drops the
--   three-argument void_last_number and recreates the one-argument version, and
--   restores sync_game_states_public, both verbatim as pg_get_functiondef
--   printed them from a replay of every migration up to 20260929103018, with
--   the ACLs they had.
--
-- WHAT IT DOES NOT DO
--   It reverses no data and drops no column. The claim columns on game_states
--   and game_states_public, and the claim_result check constraint, stay with
--   whatever values they hold. Without the guard they are no longer cleared on
--   unpause, and without the new sync the public copies stop updating; the
--   pre-M2a app reads none of them.
--
-- ORDER
--   Roll back M2b and M3 first. The host app must be on a build that does not
--   call the claim functions.
--
-- Tested by suite F in supabase/tests/run.sh.

drop trigger if exists guard_claim_fields on public.game_states;
drop function if exists public.guard_claim_fields();

drop function if exists public.begin_claim_check(uuid, uuid, boolean);
drop function if exists public.set_claim_draft(uuid, uuid, integer[], integer);
drop function if exists public.check_claim(uuid, uuid, integer[], boolean);
drop function if exists public.required_claim_count(text);

drop function if exists public.void_last_number(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.void_last_number(p_game_id uuid)
 RETURNS public.game_states
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

revoke all on function public.void_last_number(uuid) from public;
revoke all on function public.void_last_number(uuid) from anon;
grant execute on function public.void_last_number(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_game_states_public()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    state_version
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
    new.state_version
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
    state_version = excluded.state_version;

  return new;
end;
$function$

;

revoke all on function public.sync_game_states_public() from public, anon, authenticated;
grant execute on function public.sync_game_states_public() to service_role;
