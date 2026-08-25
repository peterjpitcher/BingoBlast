-- Makes 'pending' the default for a new account, and the value handle_new_user
-- writes.
--
-- SPLIT FROM 20260825080600 ON PURPOSE, AND NOT ADJACENT TO IT
--   Postgres refuses to USE a new enum value in the same transaction that adds
--   it, and `supabase db push` wraps each migration in a transaction. The value
--   'pending' is added by 20260825080600; everything that uses it has to be in a
--   later transaction, which means a later migration. It sits at the end of the
--   run rather than next door because migration versions are timestamps and
--   there is no room between 080600 and 080601. Nothing between the two depends
--   on the default, so the ordering is safe.
--
--   Production taught this the hard way on 2026-08-25: the combined migration
--   was rejected with SQLSTATE 55P04 and rolled back cleanly.
--
-- WHY THE DEFAULT MATTERS AS WELL AS THE TRIGGER
--   The trigger is what runs for a real sign-up. The column default is what
--   catches everything else: a hand-written insert, a future code path, a
--   restore that recreates rows. Both must land inert. Never default this to a
--   role that can do anything.
--
-- SAFETY FOR EXISTING ROWS
--   Nothing is backfilled. Production holds exactly one profile, role 'admin'
--   (verified 2026-08-25), and any real host account is left exactly as it is.
--   Only accounts created AFTER this runs are affected.

alter table public.profiles alter column role set default 'pending'::public.user_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  -- 'pending' on purpose. An account is created by signing up; it is made staff
  -- by an admin, deliberately, afterwards. Never default this to a role that can
  -- do anything.
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'pending');
  return new;
end;
$function$;

-- Recreating the function rebuilds its ACL from the schema default privileges,
-- which in this project grant EXECUTE to anon, authenticated and service_role.
-- Both revokes are required: CREATE FUNCTION grants to PUBLIC by itself, and
-- anon holds a grant in its own name as well, so neither revoke covers the
-- other. This is the trap documented in
-- 20260730070705_revoke_anon_execute_on_host_rpcs.sql.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- The self-insert policy has to name the role too, or the whole thing is
-- decoration. "Users can insert their own profile." with only `auth.uid() = id`
-- lets a freshly signed up account create its OWN profile row with
-- role = 'admin', straight past the trigger, because the trigger fires on
-- auth.users and this is a direct insert into profiles. Pinning the role to
-- 'pending' in the WITH CHECK is what makes the inert default binding rather
-- than advisory.
--
-- This statement was lost for a few minutes on 2026-08-25 when this migration
-- was split out of 20260825080600, and the behavioural assertion in
-- supabase/tests/remediation-behaviour.test.sql caught it. That is exactly the
-- assertion earning its place: the catalogue looked fine, the behaviour did not.
drop policy if exists "Users can insert their own profile." on public.profiles;
create policy "Users can insert their own profile."
  on public.profiles for insert
  with check (auth.uid() = id and role = 'pending'::public.user_role);

comment on function public.handle_new_user() is
  'Creates the profiles row for a new auth user with role pending. An admin promotes it to host or admin afterwards. Never default this to a privileged role.';

comment on type public.user_role is
  'pending = signed up but not yet approved, no access to anything. host = can run a game night. admin = can also configure sessions, games and the snowball pot.';
