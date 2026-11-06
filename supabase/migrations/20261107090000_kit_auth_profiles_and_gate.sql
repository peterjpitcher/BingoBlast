-- @anchor-nights/kit auth 01: staff profiles and the active-identity gate.
--
-- Rendered for this app with the profile key column "id".
-- Standard sections 4, 9 and 14 (auth-standard.md v2.3); spec S1.2 and S1.9.
--
--   * profiles is the one source of truth for a role: admin, host or pending.
--     A project without the table gets it here. A project that already has it
--     keeps its own columns, grants and policies; only deactivated_at is added.
--   * Active staff means: role admin or host, not deactivated, Auth user not
--     banned and not deleted. No profile row means not active (fail closed).
--   * A signed-in account can never change its own role or access, whatever
--     the table grants say: the kit_profiles_guard trigger refuses it.
--   * Every function here is SECURITY DEFINER with an empty search_path and
--     fully qualified names, and nothing is executable by anon.
--   * Rollback: drop the functions and the trigger, drop deactivated_at once
--     no code reads it. Dropping profiles is never part of a rollback.

do $$
begin
  if to_regclass('public.profiles') is null then
    create table public.profiles (
      id uuid primary key references auth.users (id) on delete cascade,
      role text not null default 'pending' check (role in ('admin', 'host', 'pending')),
      created_at timestamptz not null default now()
    );
    revoke all on table public.profiles from public, anon, authenticated;
    grant select on table public.profiles to authenticated;
    grant select, insert, update, delete on table public.profiles to service_role;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) then
    raise exception 'kit auth: public.profiles has no "id" column; render the templates with the right profile id column';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ) then
    raise exception 'kit auth: public.profiles has no role column';
  end if;
end $$;

alter table public.profiles add column if not exists deactivated_at timestamptz;
alter table public.profiles enable row level security;

-- The role column's type, so the functions below can write it whether it is
-- text (Quiz Night) or an enum (Cash Bingo's public.user_role).
create or replace function public.kit_profile_role_type()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.profiles'::regclass and a.attname = 'role' and not a.attisdropped
$$;
revoke all on function public.kit_profile_role_type() from public, anon, authenticated;

-- The role a user may act with right now: their stored role when they are
-- active staff, 'pending' when they have a profile but are not active, null
-- when they have no profile at all.
create or replace function public.kit_staff_role_for(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.role::text in ('admin', 'host')
      and p.deactivated_at is null
      and (u.banned_until is null or u.banned_until <= pg_catalog.now())
      and u.deleted_at is null
    then p.role::text
    else 'pending'
  end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user
$$;
revoke all on function public.kit_staff_role_for(uuid) from public, anon, authenticated;
grant execute on function public.kit_staff_role_for(uuid) to service_role;

-- The same, for the signed-in caller. The proxy and the role helpers use it.
create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.kit_staff_role_for((select auth.uid()))
$$;
revoke all on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated, service_role;

-- The active-identity gate (standard section 4). Fail closed: no row, a
-- pending or deactivated profile, or a banned or deleted Auth user is false.
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.kit_staff_role_for((select auth.uid())) in ('admin', 'host'), false)
$$;
revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.kit_staff_role_for((select auth.uid())) = 'admin', false)
$$;
revoke all on function public.is_active_admin() from public, anon;
grant execute on function public.is_active_admin() to authenticated, service_role;

-- A signed-in account cannot promote itself, reactivate itself or move its
-- profile to another user, whatever grants an older migration left behind.
-- The service role, the database owner and SECURITY DEFINER sign-up triggers
-- are unaffected, because they do not run as anon or authenticated.
create or replace function public.kit_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and (new.role::text <> 'pending' or new.deactivated_at is not null) then
      raise exception 'profiles: a new account starts as pending' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.role::text is distinct from old.role::text
      or new.deactivated_at is distinct from old.deactivated_at
      or new.id is distinct from old.id
    ) then
      raise exception 'profiles: roles and access are changed by an admin only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.kit_profiles_guard() from public, anon, authenticated;
drop trigger if exists kit_profiles_guard on public.profiles;
create trigger kit_profiles_guard
  before insert or update on public.profiles
  for each row execute function public.kit_profiles_guard();

-- Read your own profile; an admin reads everyone's. Additive to whatever
-- policies the app already has (permissive policies are OR'd).
drop policy if exists kit_profiles_read_own on public.profiles;
create policy kit_profiles_read_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists kit_profiles_admin_read on public.profiles;
create policy kit_profiles_admin_read on public.profiles
  for select to authenticated
  using ((select public.is_active_admin()));

-- The gate itself on profiles, as on every table the authenticated role can
-- reach (spec S1.9). A pending account therefore reads no profile at all and
-- is routed to the pending screen by current_staff_role().
drop policy if exists active_staff_gate on public.profiles;
create policy active_staff_gate on public.profiles
  as restrictive for all to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

-- Admin operations, service role only (the kit's admin server actions call
-- them after checking that the caller is an active admin).
create or replace function public.kit_set_staff_role(p_user uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_deactivated timestamptz;
begin
  if p_role not in ('admin', 'host') then
    raise exception 'kit_invalid_role' using errcode = '22023';
  end if;
  execute format('select role::text, deactivated_at from public.profiles where %I = $1 for update', 'id')
    into v_old, v_deactivated using p_user;
  if v_old is null then
    raise exception 'kit_profile_missing' using errcode = 'P0002';
  end if;
  if v_deactivated is not null then
    raise exception 'kit_profile_deactivated' using errcode = '55000';
  end if;
  execute format('update public.profiles set role = $1::%s where %I = $2', public.kit_profile_role_type(), 'id')
    using p_role, p_user;
  return v_old;
end;
$$;
revoke all on function public.kit_set_staff_role(uuid, text) from public, anon, authenticated;
grant execute on function public.kit_set_staff_role(uuid, text) to service_role;

-- Leaver, steps 1 and 2: inactive and no role, in one statement. The app bans
-- the Auth user afterwards (step 3) as defence in depth.
create or replace function public.kit_deactivate_staff(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  execute format('select role::text from public.profiles where %I = $1 for update', 'id')
    into v_old using p_user;
  if v_old is null then
    raise exception 'kit_profile_missing' using errcode = 'P0002';
  end if;
  execute format(
    'update public.profiles set role = $1::%s, deactivated_at = coalesce(deactivated_at, pg_catalog.now()) where %I = $2',
    public.kit_profile_role_type(), 'id'
  ) using 'pending', p_user;
  return v_old;
end;
$$;
revoke all on function public.kit_deactivate_staff(uuid) from public, anon, authenticated;
grant execute on function public.kit_deactivate_staff(uuid) to service_role;

-- Rehire: identity and role first. The app unbans last.
create or replace function public.kit_reactivate_staff(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if p_role not in ('admin', 'host') then
    raise exception 'kit_invalid_role' using errcode = '22023';
  end if;
  execute format(
    'update public.profiles set role = $1::%s, deactivated_at = null where %I = $2 returning true',
    public.kit_profile_role_type(), 'id'
  ) into v_found using p_role, p_user;
  if v_found is null then
    raise exception 'kit_profile_missing' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.kit_reactivate_staff(uuid, text) from public, anon, authenticated;
grant execute on function public.kit_reactivate_staff(uuid, text) to service_role;
