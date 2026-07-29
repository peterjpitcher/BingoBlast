-- Migration: make the Realtime publication reproducible from migrations.
--
-- Why this exists. Production has sessions, game_states and game_states_public
-- in the supabase_realtime publication, but the repository could not reproduce
-- that state: 20251221101437_enable_realtime_sessions.sql left the game_states
-- and game_states_public statements commented out with the note that they "may
-- already be enabled". A fresh project built from these migrations would
-- therefore come up with the host screen missing its live updates and nobody
-- would know until a game was running.
--
-- Live updates depend on all three:
--   * game_states        - the host control screen subscribes to this. Without
--                          it the host sees break, undo, pause, resume and
--                          stage changes only after a manual reload.
--   * game_states_public - the pub TV at /display and the follower phone at
--                          /player subscribe to this.
--   * sessions           - both public surfaces watch active_game_id so they
--                          switch over when the host starts a game.
--
-- Every block is guarded, so this is safe to re-run and safe against a project
-- where some or all tables are already published.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise notice 'publication supabase_realtime not found, skipping Realtime assertions';
    return;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    return;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'game_states'
  ) then
    alter publication supabase_realtime add table public.game_states;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    return;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'game_states_public'
  ) then
    alter publication supabase_realtime add table public.game_states_public;
  end if;
end $$;
