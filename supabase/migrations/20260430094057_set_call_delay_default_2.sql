-- Migration: set call_delay_seconds default to 2 to match new host-instant timing.
-- The host now applies the new ball immediately on action return; display/player
-- surfaces still wait call_delay_seconds before showing it. Two seconds is the
-- agreed gap.
alter table public.game_states alter column call_delay_seconds set default 2;
alter table public.game_states_public alter column call_delay_seconds set default 2;

update public.game_states
set call_delay_seconds = 2
where call_delay_seconds = 1;

update public.game_states_public
set call_delay_seconds = 2
where call_delay_seconds = 1;
