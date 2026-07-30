-- Baseline schema for Anchor Bingo.
--
-- PROVENANCE
--   Reconstructed on 2026-07-30 from the live production database (Supabase
--   project bcmorqsgeumtmhvctvgu, "BingoBlast") by reading pg_catalog:
--   pg_type/pg_enum, pg_attribute, pg_constraint, pg_indexes, pg_policies,
--   pg_trigger, pg_class.relacl and pg_publication_tables.
--
-- WHY THIS FILE EXISTS
--   Until now this repository had no baseline. The oldest migration
--   (20251221101434_add_active_game_id) already assumed `sessions` existed, and
--   nothing in supabase/migrations ever created the core tables or enums. A
--   fresh or rebuilt project could therefore never be built from this repo at
--   all. This file supplies the pre-existing schema so the migration chain runs
--   end to end from empty.
--
-- WHAT IT REPRESENTS
--   The schema as it stood immediately BEFORE 20251221101434. Anything a later
--   migration in this repo adds is deliberately NOT created here, so the chain
--   applies cleanly in order. Specifically these are left to their own
--   migrations:
--     sessions.active_game_id                       -> 20251221101434
--     game_states.controlling_host_id / _last_seen_at -> 20251221101435
--     public.game_states_public (whole table)       -> 20251221101438
--     game_type value 'jackpot'                     -> 20260218143000
--     winners.is_snowball_eligible                  -> 20260218170000
--     game_states.state_version + bump trigger      -> 20260430094038
--     snowball_pot_history.game_id + unique index   -> 20260729231841
--
-- PREREQUISITE
--   The Supabase-managed `auth` schema must already exist (auth.users,
--   auth.uid(), auth.role()). That is true of any Supabase project. This file
--   deliberately does not create it.
--
-- RECONSTRUCTION CAVEATS (both are stated rather than hidden)
--   1. game_states.call_delay_seconds: the original default is not recoverable.
--      It is set here to 2, the earliest value evidenced anywhere in the chain.
--      20260430094057 sets it to 2 and 20260729232141 finally sets it to 3, so
--      the end state is 3 regardless of what this file chooses.
--   2. Three game_states policies are dropped by 20251221101438 ("Read access
--      for all", "Admins can insert/delete game state", "Admins can update game
--      state"). They no longer exist in production, so their definitions are
--      unrecoverable and are not recreated here. Those drops are all
--      `drop policy if exists`, so the end state is identical either way.
--
-- IDEMPOTENT: yes, every statement is guarded.
--
-- NOT applied to production, and production has no history row for this
--   version. `supabase db push` would therefore try to apply it. Every
--   statement is written to be a genuine no-op against a database that already
--   has this schema, and that was verified by replaying the whole chain twice.
--   The tidier end state is to mark it applied on production
--   (`supabase migration repair --status applied 20251201000000`) so it is
--   never actually run there. That edits the live migration history table, so
--   it needs explicit sign-off and has deliberately not been done here.

-- ---------------------------------------------------------------- enum types

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'user_role') then
    create type public.user_role as enum ('admin', 'host');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'session_status') then
    create type public.session_status as enum ('draft', 'ready', 'running', 'completed');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'game_status') then
    create type public.game_status as enum ('not_started', 'in_progress', 'completed');
  end if;
  -- 'jackpot' is added later by 20260218143000_add_jackpot_game_type.
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'game_type') then
    create type public.game_type as enum ('standard', 'snowball');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'win_stage') then
    create type public.win_stage as enum ('Line', 'Two Lines', 'Full House');
  end if;
end;
$$;

-- -------------------------------------------------------------------- tables
-- Created in dependency order: profiles -> sessions -> snowball_pots -> games
-- -> game_states -> winners -> snowball_pot_history.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        public.user_role default 'host'::public.user_role,
  created_at  timestamptz default now()
);

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  start_date       date default current_date,
  notes            text,
  status           public.session_status default 'draft'::public.session_status,
  is_test_session  boolean default false,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz default now()
);

create table if not exists public.snowball_pots (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  base_max_calls          integer not null default 48,
  base_jackpot_amount     numeric(10,2) not null default 200.00,
  calls_increment         integer not null default 2,
  jackpot_increment       numeric(10,2) not null default 20.00,
  current_max_calls       integer not null,
  current_jackpot_amount  numeric(10,2) not null,
  last_awarded_at         timestamptz,
  created_at              timestamptz default now()
);

create table if not exists public.games (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.sessions(id) on delete cascade,
  game_index         integer not null,
  name               text not null,
  type               public.game_type default 'standard'::public.game_type,
  stage_sequence     jsonb not null default '["Line", "Two Lines", "Full House"]'::jsonb,
  background_colour  text default '#ffffff'::text,
  prizes             jsonb default '{}'::jsonb,
  notes              text,
  snowball_pot_id    uuid references public.snowball_pots(id),
  created_at         timestamptz default now()
);

create table if not exists public.game_states (
  id                     uuid primary key default gen_random_uuid(),
  game_id                uuid not null unique references public.games(id) on delete cascade,
  number_sequence        jsonb,
  called_numbers         jsonb default '[]'::jsonb,
  numbers_called_count   integer default 0,
  current_stage_index    integer default 0,
  status                 public.game_status default 'not_started'::public.game_status,
  -- See reconstruction caveat 1 in the header on this default.
  call_delay_seconds     integer default 2,
  on_break               boolean default false,
  paused_for_validation  boolean default false,
  started_at             timestamptz,
  ended_at               timestamptz,
  last_call_at           timestamptz,
  updated_at             timestamptz default now(),
  display_win_type       text,
  display_win_text       text,
  display_winner_name    text
);

create table if not exists public.winners (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references public.sessions(id) on delete cascade,
  game_id              uuid not null references public.games(id) on delete cascade,
  stage                public.win_stage not null,
  winner_name          text not null,
  prize_description    text,
  prize_given          boolean default false,
  call_count_at_win    integer,
  is_snowball_jackpot  boolean default false,
  is_void              boolean default false,
  void_reason          text,
  created_at           timestamptz default now()
);

create table if not exists public.snowball_pot_history (
  id               uuid primary key default gen_random_uuid(),
  snowball_pot_id  uuid not null references public.snowball_pots(id),
  change_type      text,
  old_val_max      integer,
  new_val_max      integer,
  old_val_jackpot  numeric(10,2),
  new_val_jackpot  numeric(10,2),
  changed_by       uuid references public.profiles(id),
  created_at       timestamptz default now()
);

-- ------------------------------------------------- new-user profile creation
-- search_path is pinned by 20260527063058 and EXECUTE is revoked by
-- 20260527080524. Created here without either, matching how it originally was.
--
-- Deliberately create-if-absent rather than `create or replace`. A plain
-- `create or replace function` RESETS proconfig, so running this file against a
-- database that already has the later migrations would silently strip the
-- `search_path = public, pg_catalog` that 20260527063058 pinned, undoing the
-- hardening. Creating only when absent makes this a true no-op on an existing
-- database while still building correctly from empty.

do $outer$
begin
  if to_regprocedure('public.handle_new_user()') is null then
    execute $fn$create function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $body$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'host'); -- Default to host, manually upgrade to admin later
  return new;
end;
$body$$fn$;
  end if;
end;
$outer$;

do $$
begin
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'auth' and c.relname = 'users'
                   and t.tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end;
$$;

-- ----------------------------------------------------------------- row level

alter table public.profiles             enable row level security;
alter table public.sessions             enable row level security;
alter table public.snowball_pots        enable row level security;
alter table public.games                enable row level security;
alter table public.game_states          enable row level security;
alter table public.winners              enable row level security;
alter table public.snowball_pot_history enable row level security;

-- profiles: the permissive select policy here is replaced by
-- 20260430124552_tighten_profiles_select.
drop policy if exists "Users can insert their own profile." on public.profiles;
create policy "Users can insert their own profile."
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Admins can update profiles." on public.profiles;
create policy "Admins can update profiles."
  on public.profiles for update
  using (exists (select 1 from public.profiles profiles_1
                 where profiles_1.id = auth.uid() and profiles_1.role = 'admin'::public.user_role));

drop policy if exists "Read access for all" on public.sessions;
create policy "Read access for all"
  on public.sessions for select
  using (true);

drop policy if exists "Admins can manage sessions" on public.sessions;
create policy "Admins can manage sessions"
  on public.sessions for all
  using (exists (select 1 from public.profiles
                 where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role));

drop policy if exists "Read access for all" on public.games;
create policy "Read access for all"
  on public.games for select
  using (true);

drop policy if exists "Admins can manage games" on public.games;
create policy "Admins can manage games"
  on public.games for all
  using (exists (select 1 from public.profiles
                 where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role));

drop policy if exists "Read access for all authenticated users" on public.snowball_pots;
create policy "Read access for all authenticated users"
  on public.snowball_pots for select
  using (auth.role() = 'authenticated'::text or auth.role() = 'anon'::text);

drop policy if exists "Admins can update pots" on public.snowball_pots;
create policy "Admins can update pots"
  on public.snowball_pots for all
  using (exists (select 1 from public.profiles
                 where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role));

drop policy if exists "Admins view history" on public.snowball_pot_history;
create policy "Admins view history"
  on public.snowball_pot_history for select
  using (exists (select 1 from public.profiles
                 where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role));

drop policy if exists "Read access for all" on public.winners;
create policy "Read access for all"
  on public.winners for select
  using (true);

drop policy if exists "Hosts/Admins can create winners" on public.winners;
create policy "Hosts/Admins can create winners"
  on public.winners for insert
  with check (exists (select 1 from public.profiles
                      where profiles.id = auth.uid()
                        and (profiles.role = 'admin'::public.user_role
                          or profiles.role = 'host'::public.user_role)));

drop policy if exists "Admins can update winners" on public.winners;
create policy "Admins can update winners"
  on public.winners for update
  using (exists (select 1 from public.profiles
                 where profiles.id = auth.uid() and profiles.role = 'admin'::public.user_role));

-- --------------------------------------------------------------------- grants
-- Matches the Supabase default posture: the API roles hold table privileges and
-- RLS is what actually constrains access.

grant all on table public.profiles,
                   public.sessions,
                   public.snowball_pots,
                   public.games,
                   public.game_states,
                   public.winners,
                   public.snowball_pot_history
  to anon, authenticated, service_role;

-- --------------------------------------------------------------- realtime pub
-- Supabase creates this publication for every project. Guarded so the chain can
-- also be replayed against a plain Postgres. Table membership is added later by
-- 20251221101437, 20251221101438 and 20260729231901.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
