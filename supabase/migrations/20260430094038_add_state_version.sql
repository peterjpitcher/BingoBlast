-- Migration: add state_version for ordering Realtime + polling payloads
-- Reason: updated_at is not maintained on every update; we need a monotonic
-- counter so host/display/player surfaces can detect stale snapshots.

alter table public.game_states
  add column if not exists state_version bigint not null default 0;

alter table public.game_states_public
  add column if not exists state_version bigint not null default 0;

-- Bump state_version on every update to game_states. The DELETE branch is left
-- alone; the row goes away anyway and the public mirror is cleared by the
-- existing sync trigger.
create or replace function public.bump_game_state_version()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    new.state_version := coalesce(old.state_version, 0) + 1;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_game_state_version on public.game_states;

create trigger bump_game_state_version
before update on public.game_states
for each row execute function public.bump_game_state_version();

-- The existing sync_game_states_public() copies fields from game_states to
-- game_states_public. It must include state_version so public clients see the
-- same ordering value as the host. Preserve the existing DELETE branch.
create or replace function public.sync_game_states_public()
returns trigger as $$
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
$$ language plpgsql security definer;

-- Backfill state_version on existing public rows so they match host rows.
update public.game_states_public gsp
set state_version = gs.state_version
from public.game_states gs
where gs.game_id = gsp.game_id;
