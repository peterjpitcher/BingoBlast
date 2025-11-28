-- Anchor Bingo Database Schema
-- Run this in the Supabase SQL Editor

-- 1. ENUMS
create type user_role as enum ('admin', 'host');
create type session_status as enum ('draft', 'ready', 'running', 'completed');
create type game_type as enum ('standard', 'snowball');
create type game_status as enum ('not_started', 'in_progress', 'completed');
create type win_stage as enum ('Line', 'Two Lines', 'Full House');

-- 2. PROFILES (Extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  role user_role default 'host'::user_role,
  created_at timestamptz default now()
);
-- Secure the profiles table
alter table public.profiles enable row level security;
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);
create policy "Users can insert their own profile." on public.profiles for insert with check (auth.uid() = id);
create policy "Admins can update profiles." on public.profiles for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Trigger to auto-create profile on signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'host'); -- Default to host, manually upgrade to admin later
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 3. SNOWBALL POTS
create table public.snowball_pots (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  base_max_calls int not null default 48,
  base_jackpot_amount decimal(10,2) not null default 200.00,
  calls_increment int not null default 2,
  jackpot_increment decimal(10,2) not null default 20.00,
  current_max_calls int not null,
  current_jackpot_amount decimal(10,2) not null,
  last_awarded_at timestamptz,
  created_at timestamptz default now()
);
alter table public.snowball_pots enable row level security;
create policy "Read access for all authenticated users" on public.snowball_pots for select using (auth.role() = 'authenticated' or auth.role() = 'anon'); -- anon needed for display?
create policy "Admins can update pots" on public.snowball_pots for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 4. SESSIONS
create table public.sessions (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  start_date date default current_date,
  notes text,
  status session_status default 'draft'::session_status,
  is_test_session boolean default false,
  created_by uuid references public.profiles(id),
  active_game_id uuid references public.games(id), -- New: ID of the game currently active on display
  created_at timestamptz default now()
);
alter table public.sessions enable row level security;
create policy "Read access for all" on public.sessions for select using (true);
create policy "Admins can manage sessions" on public.sessions for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 5. GAMES
create table public.games (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  game_index int not null, -- order 1, 2, 3
  name text not null,
  type game_type default 'standard'::game_type,
  stage_sequence jsonb not null default '["Line", "Two Lines", "Full House"]'::jsonb,
  background_colour text default '#ffffff',
  prizes jsonb default '{}'::jsonb, -- {"Line": "£10", "Full House": "£50"}
  notes text,
  snowball_pot_id uuid references public.snowball_pots(id),
  created_at timestamptz default now()
);
alter table public.games enable row level security;
create policy "Read access for all" on public.games for select using (true);
create policy "Admins can manage games" on public.games for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 6. GAME STATE (Realtime frequent updates)
create table public.game_states (
  id uuid default gen_random_uuid() primary key,
  game_id uuid references public.games(id) on delete cascade unique not null,
  number_sequence jsonb, -- The shuffled 1-90 array [5, 89, 12...]
  called_numbers jsonb default '[]'::jsonb, -- Array of numbers called so far [5, 89]
  numbers_called_count int default 0,
  current_stage_index int default 0,
  status game_status default 'not_started'::game_status,
  call_delay_seconds int default 8,
  on_break boolean default false,
  paused_for_validation boolean default false,
  display_win_type text default null, -- 'line', 'two_lines', 'full_house', 'snowball'
  display_win_text text default null, -- e.g., "Line Winner!"
  display_winner_name text default null, -- Optional: "Dave - Table 6"
  controlling_host_id uuid references auth.users(id), -- New: ID of the host controlling the game
  controller_last_seen_at timestamptz, -- New: Timestamp of last heartbeat
  started_at timestamptz,
  ended_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.game_states enable row level security;
create policy "Read access for all" on public.game_states for select using (true);
create policy "Hosts/Admins can update game state" on public.game_states for update using (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
create policy "Admins can insert/delete game state" on public.game_states for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Enable Realtime for game_states (Crucial for Display/Host sync)
alter publication supabase_realtime add table public.game_states;


-- 7. WINNERS
create table public.winners (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  game_id uuid references public.games(id) on delete cascade not null,
  stage win_stage not null,
  winner_name text not null,
  prize_description text,
  prize_given boolean default false,
  call_count_at_win int,
  is_snowball_jackpot boolean default false,
  is_void boolean default false,
  void_reason text,
  created_at timestamptz default now()
);
alter table public.winners enable row level security;
create policy "Read access for all" on public.winners for select using (true);
create policy "Hosts/Admins can create winners" on public.winners for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or role = 'host'))
);
create policy "Admins can update winners" on public.winners for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 8. AUDIT / HISTORY (Optional but recommended for Snowball)
create table public.snowball_pot_history (
  id uuid default gen_random_uuid() primary key,
  snowball_pot_id uuid references public.snowball_pots(id) not null,
  change_type text, -- 'manual_adjust', 'game_won', 'rollover'
  old_val_max int,
  new_val_max int,
  old_val_jackpot decimal(10,2),
  new_val_jackpot decimal(10,2),
  changed_by uuid references public.profiles(id),
  created_at timestamptz default now()
);
alter table public.snowball_pot_history enable row level security;
create policy "Admins view history" on public.snowball_pot_history for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

