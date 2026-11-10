-- @anchor-nights/kit auth: the active-identity gate on public.game_states.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.game_states enable row level security;
drop policy if exists active_staff_gate on public.game_states;
create policy active_staff_gate on public.game_states
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.game_states_public.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.game_states_public enable row level security;
drop policy if exists active_staff_gate on public.game_states_public;
create policy active_staff_gate on public.game_states_public
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.games.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.games enable row level security;
drop policy if exists active_staff_gate on public.games;
create policy active_staff_gate on public.games
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.sessions.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.sessions enable row level security;
drop policy if exists active_staff_gate on public.sessions;
create policy active_staff_gate on public.sessions
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.session_reset_log.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.session_reset_log enable row level security;
drop policy if exists active_staff_gate on public.session_reset_log;
create policy active_staff_gate on public.session_reset_log
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.snowball_pot_history.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.snowball_pot_history enable row level security;
drop policy if exists active_staff_gate on public.snowball_pot_history;
create policy active_staff_gate on public.snowball_pot_history
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.snowball_pots.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.snowball_pots enable row level security;
drop policy if exists active_staff_gate on public.snowball_pots;
create policy active_staff_gate on public.snowball_pots
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- @anchor-nights/kit auth: the active-identity gate on public.winners.
-- Restrictive, so it narrows every other policy on the table: an account that
-- is not active staff (pending, deactivated, banned or deleted) reaches no row
-- here through the Data API, RPC or Realtime, even with a still-valid JWT.
alter table public.winners enable row level security;
drop policy if exists active_staff_gate on public.winners;
create policy active_staff_gate on public.winners
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));
