-- Migration: backfill remaining call_delay_seconds rows to 2
-- The previous 20260218190500 migration that set call_delay_seconds to 1 was
-- never applied to remote, so existing rows still hold the original default of 8.
-- The 20260430120100 migration only updated where call_delay_seconds = 1, so
-- those rows at 8 remained unchanged. Set them to 2 so the new default applies
-- to existing live game state rows as well.

update public.game_states
set call_delay_seconds = 2
where call_delay_seconds <> 2;

update public.game_states_public
set call_delay_seconds = 2
where call_delay_seconds <> 2;
