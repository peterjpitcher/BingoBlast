-- Set call delay to 1 second across host/display/player surfaces.
alter table public.game_states
  alter column call_delay_seconds set default 1;

alter table public.game_states_public
  alter column call_delay_seconds set default 1;

update public.game_states
set call_delay_seconds = 1
where call_delay_seconds is null or call_delay_seconds <> 1;

update public.game_states_public
set call_delay_seconds = 1
where call_delay_seconds is null or call_delay_seconds <> 1;
