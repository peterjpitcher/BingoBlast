-- Rollback for the 2026-07-29 live game fixes.
--
-- Run ONLY if the application is rolled back to the pre-2026-07-29 code, which
-- reads call_delay_seconds as the host call gap. Leaving it at 3 with the old
-- code deployed forces the host to wait 3 seconds between calls.
--
-- Nothing here destroys data. The only change is one integer column moving from
-- 3 back to 2 on both tables.

-- The WHERE clause matters twice over: it leaves any deliberate per-game delay
-- alone, and it avoids bumping state_version on every row (the BEFORE UPDATE
-- trigger fires on any write), which would push a no-op change to every TV and
-- phone at once.
update public.game_states        set call_delay_seconds = 2 where call_delay_seconds is distinct from 2;
update public.game_states_public set call_delay_seconds = 2 where call_delay_seconds is distinct from 2;

-- Restore the pre-change column defaults. Not optional: leaving the defaults at
-- 3 means the next inserted game_states row gets a 3-second host call gap under
-- the old code, which is the exact failure this rollback exists to prevent.
alter table public.game_states        alter column call_delay_seconds set default 2;
alter table public.game_states_public alter column call_delay_seconds set default 2;

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

-- 20260729120300_snowball_audit_and_settlement_guard.sql is additive too, and
-- should be LEFT IN PLACE on a rollback. The old code inserts snowball_pot_history
-- rows without game_id, which the nullable column and the partial unique index
-- both allow, and it benefits from the INSERT policy just as much: without it the
-- old code reports a working pot rollover to the host as a failure.
--
-- Only if the column and index must go, and accepting that this discards the
-- game_id settlement claims and with them the protection against a re-ended game
-- rolling the pot twice:
-- drop index if exists public.snowball_pot_history_pot_game_unique;
-- alter table public.snowball_pot_history drop column if exists game_id;
-- The INSERT policy has no reason to be dropped in any scenario, but for
-- completeness:
-- drop policy if exists "Admins insert history" on public.snowball_pot_history;
