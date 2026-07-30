-- Test harness schema. NOT production DDL, and never applied to a real project.
--
-- A minimal but faithful reproduction of the tables record_winner_atomic touches,
-- mirroring docs/schema.sql plus the columns later migrations added
-- (is_snowball_eligible, is_void, state_version). auth.uid() is stubbed off a
-- session setting so a test can act as a given host, which is the one thing a
-- plain Postgres container cannot supply.
--
-- winners deliberately has NO client_request_id here: the migration under test is
-- what adds it, and the legacy rows seeded at the bottom are what prove the
-- migration leaves history alone.
--
-- Run via supabase/tests/run.sh.

create schema if not exists auth;

create table auth.users (id uuid primary key);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create type user_role as enum ('admin', 'host');
create type session_status as enum ('draft', 'ready', 'running', 'completed');
create type game_type as enum ('standard', 'snowball', 'jackpot');
create type game_status as enum ('not_started', 'in_progress', 'completed');
create type win_stage as enum ('Line', 'Two Lines', 'Full House');

create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  role user_role default 'host'::user_role,
  created_at timestamptz default now()
);

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

create table public.sessions (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  start_date date default current_date,
  notes text,
  status session_status default 'draft'::session_status,
  is_test_session boolean default false,
  created_by uuid references public.profiles(id),
  active_game_id uuid,
  created_at timestamptz default now()
);

create table public.games (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  game_index int not null,
  name text not null,
  type game_type default 'standard'::game_type,
  stage_sequence jsonb not null default '["Line", "Two Lines", "Full House"]'::jsonb,
  background_colour text default '#ffffff',
  prizes jsonb default '{}'::jsonb,
  notes text,
  snowball_pot_id uuid references public.snowball_pots(id),
  created_at timestamptz default now()
);

create table public.game_states (
  id uuid default gen_random_uuid() primary key,
  game_id uuid references public.games(id) on delete cascade unique not null,
  number_sequence jsonb,
  called_numbers jsonb default '[]'::jsonb,
  numbers_called_count int default 0,
  current_stage_index int default 0,
  status game_status default 'not_started'::game_status,
  call_delay_seconds int default 2,
  on_break boolean default false,
  paused_for_validation boolean default false,
  display_win_type text default null,
  display_win_text text default null,
  display_winner_name text default null,
  controlling_host_id uuid references auth.users(id),
  controller_last_seen_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz default now(),
  state_version bigint not null default 0
);

create table public.game_states_public (
  game_id uuid references public.games(id) on delete cascade primary key,
  called_numbers jsonb default '[]'::jsonb,
  numbers_called_count int default 0,
  current_stage_index int default 0,
  status game_status default 'not_started'::game_status,
  call_delay_seconds int default 2,
  on_break boolean default false,
  paused_for_validation boolean default false,
  display_win_type text default null,
  display_win_text text default null,
  display_winner_name text default null,
  started_at timestamptz,
  ended_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz default now(),
  state_version bigint not null default 0
);

create table public.winners (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references public.sessions(id) on delete cascade not null,
  game_id uuid references public.games(id) on delete cascade not null,
  stage win_stage not null,
  winner_name text not null,
  prize_description text,
  prize_given boolean default false,
  call_count_at_win int,
  is_snowball_eligible boolean default false,
  is_snowball_jackpot boolean default false,
  is_void boolean default false,
  void_reason text,
  created_at timestamptz default now()
);

create or replace function public.bump_game_state_version()
returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    new.state_version := coalesce(old.state_version, 0) + 1;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger bump_game_state_version
before update on public.game_states
for each row execute function public.bump_game_state_version();

create or replace function public.sync_game_states_public()
returns trigger as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.game_states_public where game_id = old.game_id;
    return old;
  end if;

  insert into public.game_states_public (
    game_id, called_numbers, numbers_called_count, current_stage_index, status,
    call_delay_seconds, on_break, paused_for_validation, display_win_type,
    display_win_text, display_winner_name, started_at, ended_at, last_call_at,
    updated_at, state_version
  ) values (
    new.game_id, new.called_numbers, new.numbers_called_count,
    new.current_stage_index, new.status, new.call_delay_seconds, new.on_break,
    new.paused_for_validation, new.display_win_type, new.display_win_text,
    new.display_winner_name, new.started_at, new.ended_at, new.last_call_at,
    new.updated_at, new.state_version
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
    updated_at = excluded.updated_at,
    state_version = excluded.state_version;

  return new;
end;
$$ language plpgsql;

create trigger on_game_states_upsert
after insert or update on public.game_states
for each row execute procedure public.sync_game_states_public();

create trigger on_game_states_delete
after delete on public.game_states
for each row execute procedure public.sync_game_states_public();

-- Roles the migration grants to.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures. One host, one rival host, two standard games mid-Line, and a
-- snowball game on Full House with the jackpot window open (30 calls <= 48).
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.profiles (id, email, role) values
  ('11111111-1111-4111-8111-111111111111', 'host@test', 'host'),
  ('22222222-2222-4222-8222-222222222222', 'rival@test', 'host');

insert into public.snowball_pots (id, name, current_max_calls, current_jackpot_amount)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Main pot', 48, 240.00);

insert into public.sessions (id, name, status) values
  ('55555555-5555-4555-8555-555555555555', 'Test night', 'running'),
  ('88888888-8888-4888-8888-888888888888', 'Snowball night', 'running');

insert into public.games (id, session_id, game_index, name, type) values
  ('66666666-6666-4666-8666-666666666666',
   '55555555-5555-4555-8555-555555555555', 1, 'Game 1', 'standard'),
  ('77777777-7777-4777-8777-777777777777',
   '55555555-5555-4555-8555-555555555555', 2, 'Game 2', 'standard');

insert into public.games (id, session_id, game_index, name, type, snowball_pot_id)
values ('99999999-9999-4999-8999-999999999999',
        '88888888-8888-4888-8888-888888888888', 1, 'Snowball', 'snowball',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into public.game_states (
  game_id, number_sequence, called_numbers, numbers_called_count,
  current_stage_index, status, controlling_host_id, last_call_at
) values
  ('66666666-6666-4666-8666-666666666666',
   (select jsonb_agg(g) from generate_series(1, 90) g),
   (select jsonb_agg(g) from generate_series(1, 12) g), 12, 0, 'in_progress',
   '11111111-1111-4111-8111-111111111111', now() - interval '5 seconds'),
  ('77777777-7777-4777-8777-777777777777',
   (select jsonb_agg(g) from generate_series(1, 90) g),
   (select jsonb_agg(g) from generate_series(1, 5) g), 5, 0, 'in_progress',
   '11111111-1111-4111-8111-111111111111', now() - interval '5 seconds'),
  ('99999999-9999-4999-8999-999999999999',
   (select jsonb_agg(g) from generate_series(1, 90) g),
   (select jsonb_agg(g) from generate_series(1, 30) g), 30, 2, 'in_progress',
   '11111111-1111-4111-8111-111111111111', now() - interval '5 seconds');

-- Two winners rows that predate the idempotency key, standing in for production
-- history. They must come out of the migration untouched, with a null key.
insert into public.winners (session_id, game_id, stage, winner_name, call_count_at_win)
values
  ('55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'Line', 'Anonymous', 9),
  ('55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'Line', 'Anonymous', 9);
