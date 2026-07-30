-- Migration: call_delay_seconds becomes purely the public reveal delay.
--
-- Why this exists. One column was doing two jobs: the server's minimum gap
-- between host calls, and the delay before the public surfaces reveal a ball.
-- That meant raising the guest-facing suspense also forced the host to wait
-- between calls, which is why the host could not call quickly.
--
-- After this migration:
--   * call_delay_seconds means only "how long /display and /player wait after
--     last_call_at before showing a ball". Default and backfill value 3.
--   * the host anti-double-tap gap is the constant HOST_MIN_CALL_GAP_MS in
--     src/lib/call-timing.ts, passed into public.call_next_number as a
--     parameter. It is not stored in the database.
--
-- Deployment order matters. The application code must be live before this runs,
-- because the pre-change code reads call_delay_seconds as the host gap and
-- would force the host to wait 3 seconds between calls. The reverse window is
-- harmless: new code against the old value of 2 simply reveals a ball a second
-- early. Rollback SQL is committed at
-- docs/superpowers/plans/2026-07-29-rollback.sql.

alter table public.game_states
  alter column call_delay_seconds set default 3;

alter table public.game_states_public
  alter column call_delay_seconds set default 3;

-- Order is deliberate. Updating game_states fires bump_game_state_version and
-- the on_game_states_upsert sync trigger, which pushes call_delay_seconds into
-- game_states_public for every row that has a mirror. The direct update on
-- game_states_public afterwards catches any mirror row whose source row was
-- already 3, so it must run second or the mirror could be left behind.
update public.game_states
   set call_delay_seconds = 3
 where call_delay_seconds is distinct from 3;

update public.game_states_public
   set call_delay_seconds = 3
 where call_delay_seconds is distinct from 3;

comment on column public.game_states.call_delay_seconds is
  'Public reveal delay in seconds: how long /display and /player wait after last_call_at before showing a ball. NOT a host call gap - the host gap is HOST_MIN_CALL_GAP_MS in src/lib/call-timing.ts.';

comment on column public.game_states_public.call_delay_seconds is
  'Mirror of game_states.call_delay_seconds. Public reveal delay in seconds, not a host call gap.';
