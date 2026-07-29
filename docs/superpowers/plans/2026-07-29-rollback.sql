-- Rollback for the 2026-07-29 live game fixes.
--
-- Run ONLY if the application is rolled back to the pre-2026-07-29 code, which
-- reads call_delay_seconds as the host call gap. Leaving it at 3 with the old
-- code deployed forces the host to wait 3 seconds between calls.
--
-- Nothing here destroys data. The only change is one integer column moving from
-- 3 back to 2 on both tables.

update public.game_states        set call_delay_seconds = 2;
update public.game_states_public set call_delay_seconds = 2;

-- Optional: restore the pre-change column defaults.
-- alter table public.game_states        alter column call_delay_seconds set default 2;
-- alter table public.game_states_public alter column call_delay_seconds set default 2;

-- The atomic host functions are additive. The old code does not call them, so
-- they can be left in place and no rollback is needed. To remove them anyway,
-- in dependency order:
-- drop function if exists public.record_winner_atomic(uuid, uuid, public.win_stage, text, boolean, boolean, boolean);
-- drop function if exists public.void_last_number(uuid);
-- drop function if exists public.call_next_number(uuid, int);
-- drop function if exists public.assert_is_host();

-- The Realtime publication assertions are also additive and match what
-- production already had. Do not remove tables from supabase_realtime: doing so
-- breaks live updates for both the current and the rolled-back code.
