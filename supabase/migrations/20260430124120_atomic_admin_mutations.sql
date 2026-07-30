-- Migration: atomic versions of admin mutations to close TOCTOU races.
--
-- The previous read-then-write/delete patterns could be defeated by concurrent
-- host actions slipping between the precheck and the destructive statement.
-- These functions perform the check and the mutation under a single row lock
-- inside one transaction so the precheck is binding for the lifetime of the
-- mutation.

-- Helper: assert the current authenticated user is an admin.
create or replace function public.assert_is_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'unauthorized: admin role required';
  end if;
end;
$$;

revoke all on function public.assert_is_admin from public;
grant execute on function public.assert_is_admin to authenticated;

-- update_game_safe: updates a game's editable fields. When the game has
-- progressed past not_started, only allows the non-structural fields
-- (name, game_index, background_colour, notes) — type, snowball_pot_id,
-- stage_sequence, and prizes are silently preserved.
create or replace function public.update_game_safe(
  p_game_id uuid,
  p_name text,
  p_game_index int,
  p_background_colour text,
  p_notes text,
  p_type public.game_type,
  p_snowball_pot_id uuid,
  p_stage_sequence jsonb,
  p_prizes jsonb
) returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.game_status;
  v_game public.games;
begin
  perform public.assert_is_admin();

  -- Lock the game_states row (if any) for the duration of this transaction.
  select status into v_status from public.game_states
   where game_id = p_game_id
   for update;

  if v_status is not null and v_status <> 'not_started' then
    -- Locked: only update non-structural fields.
    update public.games
       set name = p_name,
           game_index = p_game_index,
           background_colour = p_background_colour,
           notes = p_notes
     where id = p_game_id
     returning * into v_game;
  else
    -- Unlocked: update everything.
    update public.games
       set name = p_name,
           game_index = p_game_index,
           background_colour = p_background_colour,
           notes = p_notes,
           type = p_type,
           snowball_pot_id = p_snowball_pot_id,
           stage_sequence = p_stage_sequence,
           prizes = p_prizes
     where id = p_game_id
     returning * into v_game;
  end if;

  if v_game.id is null then
    raise exception 'Game % not found', p_game_id;
  end if;

  return v_game;
end;
$$;

revoke all on function public.update_game_safe(uuid, text, int, text, text, public.game_type, uuid, jsonb, jsonb) from public;
grant execute on function public.update_game_safe(uuid, text, int, text, text, public.game_type, uuid, jsonb, jsonb) to authenticated;

-- delete_game_safe: rejects if the game is in_progress/completed or has winners.
create or replace function public.delete_game_safe(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.game_status;
  v_winner_count int;
begin
  perform public.assert_is_admin();

  select status into v_status from public.game_states
   where game_id = p_game_id
   for update;

  if v_status is not null and v_status <> 'not_started' then
    raise exception 'Cannot delete a game with status %', v_status;
  end if;

  select count(*) into v_winner_count from public.winners
   where game_id = p_game_id;

  if v_winner_count > 0 then
    raise exception 'Cannot delete a game that has recorded winners';
  end if;

  delete from public.games where id = p_game_id;
end;
$$;

revoke all on function public.delete_game_safe(uuid) from public;
grant execute on function public.delete_game_safe(uuid) to authenticated;

-- delete_session_safe: rejects if any game in the session is started or has winners.
create or replace function public.delete_session_safe(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad_count int;
  v_winner_count int;
begin
  perform public.assert_is_admin();

  -- Lock all game_states rows that belong to this session.
  perform 1 from public.game_states gs
   join public.games g on g.id = gs.game_id
   where g.session_id = p_session_id
   for update;

  select count(*) into v_bad_count from public.game_states gs
   join public.games g on g.id = gs.game_id
   where g.session_id = p_session_id
     and gs.status <> 'not_started';

  if v_bad_count > 0 then
    raise exception 'Cannot delete a session with started or completed games';
  end if;

  select count(*) into v_winner_count from public.winners
   where session_id = p_session_id;

  if v_winner_count > 0 then
    raise exception 'Cannot delete a session that has recorded winners';
  end if;

  delete from public.sessions where id = p_session_id;
end;
$$;

revoke all on function public.delete_session_safe(uuid) from public;
grant execute on function public.delete_session_safe(uuid) to authenticated;

-- reset_session_safe: atomically wipes game_states and winners for a session
-- and resets sessions.active_game_id + status. One transaction so a partial
-- failure cannot leave a half-reset session.
create or replace function public.reset_session_safe(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_is_admin();

  delete from public.winners where session_id = p_session_id;

  delete from public.game_states gs
   using public.games g
   where gs.game_id = g.id and g.session_id = p_session_id;

  update public.sessions
     set status = 'ready', active_game_id = null
   where id = p_session_id;
end;
$$;

revoke all on function public.reset_session_safe(uuid) from public;
grant execute on function public.reset_session_safe(uuid) to authenticated;
