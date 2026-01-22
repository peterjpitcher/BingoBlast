-- Add public-safe game state table and tighten access to number_sequence

-- 1. Restrict game_states reads to hosts/admins
drop policy if exists "Read access for all" on public.game_states;
drop policy if exists "Admins can insert/delete game state" on public.game_states;
drop policy if exists "Admins can update game state" on public.game_states;
drop policy if exists "Hosts/Admins can update game state" on public.game_states;

DROP POLICY IF EXISTS "Hosts/Admins can read game state" ON public.game_states;
create policy "Hosts/Admins can read game state" on public.game_states for select using (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
DROP POLICY IF EXISTS "Hosts/Admins can insert game state" ON public.game_states;
create policy "Hosts/Admins can insert game state" on public.game_states for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
DROP POLICY IF EXISTS "Hosts/Admins can update game state" ON public.game_states;
create policy "Hosts/Admins can update game state" on public.game_states for update using (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
DROP POLICY IF EXISTS "Admins can delete game state" ON public.game_states;
create policy "Admins can delete game state" on public.game_states for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 2. Public-safe table
create table if not exists public.game_states_public (
  game_id uuid references public.games(id) on delete cascade primary key,
  called_numbers jsonb default '[]'::jsonb,
  numbers_called_count int default 0,
  current_stage_index int default 0,
  status game_status default 'not_started'::game_status,
  call_delay_seconds int default 8,
  on_break boolean default false,
  paused_for_validation boolean default false,
  display_win_type text default null,
  display_win_text text default null,
  display_winner_name text default null,
  started_at timestamptz,
  ended_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz default now()
);

alter table public.game_states_public enable row level security;
DROP POLICY IF EXISTS "Read access for all" ON public.game_states_public;
create policy "Read access for all" on public.game_states_public for select using (true);

-- 3. Sync trigger
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
    updated_at
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
    new.updated_at
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
    updated_at = excluded.updated_at;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_game_states_upsert on public.game_states;
create trigger on_game_states_upsert
after insert or update on public.game_states
for each row execute procedure public.sync_game_states_public();

drop trigger if exists on_game_states_delete on public.game_states;
create trigger on_game_states_delete
after delete on public.game_states
for each row execute procedure public.sync_game_states_public();

-- 4. Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'game_states_public'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_states_public;
  END IF;
END $$;

-- 5. Backfill existing game state rows
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
  updated_at
) 
select
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
  updated_at
from public.game_states
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
  updated_at = excluded.updated_at;
