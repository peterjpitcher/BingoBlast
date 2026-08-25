-- New accounts land inert instead of landing as staff.
--
-- WHY
--   handle_new_user() inserted every new auth.users row into public.profiles
--   with role = 'host', and user_role had only {admin, host}, so there was no
--   unprivileged tier for an account to land in. Combined with self-signup being
--   enabled on the project (verified 2026-08-25: GET /auth/v1/settings returned
--   disable_signup false), anyone who could read the public anon key off the
--   /display or /player page could sign up, confirm their own email, and hold a
--   host account: enough to call balls, void balls, record winners and move the
--   snowball pot on a live game.
--
--   The app's own signup() server action returns "Registration is invite-only",
--   but that is decoration. It does not touch GoTrue's /auth/v1/signup endpoint,
--   which is public unless the project setting says otherwise.
--
-- THIS IS ONE OF TWO FIXES, AND IT IS THE ONE THAT LASTS
--   The other is turning "Allow new users to sign up" off in the Supabase
--   dashboard. That is the emergency stop and it must be done, but it is an
--   untracked hosted setting that can drift back. This migration is the part
--   that holds regardless: even with signup on, a new account is inert until an
--   admin deliberately promotes it.
--
-- SAFETY FOR EXISTING ROWS
--   Nothing is backfilled. Production holds exactly one profile, role 'admin'
--   (verified 2026-08-25), and any real host account created between now and
--   this migration is left exactly as it is. Only accounts created AFTER this
--   runs are affected.
--
-- POSTGRES NOTE
--   `alter type ... add value` may not have its new value USED in the same
--   transaction that adds it. The function below only mentions 'pending' inside
--   a plpgsql body, which is not evaluated at creation time, so this is safe to
--   run as one migration. Do not add a backfill that writes 'pending' here.
--
-- APPLICATION COMPATIBILITY
--   Deploy the app first, or together. src/utils/supabase/middleware.ts must
--   already require an explicit admin or host role before this runs, otherwise a
--   pending account could reach /host and be refused only by RLS, which would
--   look like a broken screen rather than a refusal. The /pending page is the
--   destination for such an account.

alter type public.user_role add value if not exists 'pending';

-- The default matters as much as the trigger. A hand-written insert that omits
-- the role must also land inert.
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

-- ---------------------------------------------------------------------------
-- The self-insert policy has to name the role too.
--
-- "Users can insert their own profile." checked only `auth.uid() = id` and said
-- nothing about `role`. The trigger normally creates the row, so the policy
-- looks unreachable, but the moment a profile row is missing (trigger failure,
-- a manual delete, a restore) the holder of that account can insert their own
-- with role 'admin'. A policy that grants self-promotion in its failure mode is
-- worth closing whether or not the failure mode is likely.
-- ---------------------------------------------------------------------------
drop policy if exists "Users can insert their own profile." on public.profiles;
create policy "Users can insert their own profile."
  on public.profiles for insert
  with check (auth.uid() = id and role = 'pending'::public.user_role);

comment on function public.handle_new_user() is
  'Creates the profiles row for a new auth user with role pending. An admin promotes it to host or admin afterwards. Never default this to a privileged role.';

comment on type public.user_role is
  'pending = signed up but not yet approved, no access to anything. host = can run a game night. admin = can also configure sessions, games and the snowball pot.';
