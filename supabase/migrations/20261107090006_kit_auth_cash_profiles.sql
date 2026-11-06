-- Cash Bingo's own step after the kit's auth migrations (spec S1, row C-5):
-- narrow who can read staff profiles, keep the admin profile update working
-- under the kit's policies, and make the identity backfill explicit.
--
-- WHY THE PROFILE READ POLICY GOES
--   "Authenticated users can view profiles" (20260430124552, using (true))
--   let any signed-in account, a host or even a pending one, read every staff
--   profile: emails and roles. Its predecessor "Public profiles are viewable by
--   everyone." did the same for anon. The kit's gate does not remove a
--   permissive policy, so it is dropped here. What replaces it, from
--   20261107090000_kit_auth_profiles_and_gate: kit_profiles_read_own (your own
--   row) and kit_profiles_admin_read (an active admin reads all), both behind
--   the restrictive active_staff_gate.
--
--   Every reader of profiles was checked before narrowing (7 Nov 2026):
--     * App code reads only the caller's own role, now through
--       current_staff_role() (src/lib/auth/staff-role.ts); /api/setup and the
--       kit's staff list read through the service role.
--     * assert_is_admin, assert_is_host and handle_new_user read profiles as
--       SECURITY DEFINER, so RLS does not apply to them: the money boundary is
--       untouched and the same roles can call the same functions.
--     * RLS policies on other tables check `profiles.id = auth.uid()`, the
--       caller's own row, which kit_profiles_read_own still allows.
--     * No view reads profiles, and no PostgREST embed in the app joins it.
--
-- THE IDENTITY BACKFILL (auth standard section 4, "before enabling the gate")
--   The gate fails closed: no profile, a pending one, a deactivated one, or a
--   banned or deleted Auth user means no access. Existing admin and host
--   profiles stay active: deactivated_at is new and null for every row. An
--   Auth user with no profile row (none expected, because handle_new_user
--   makes one for every new user) gets a pending one, which grants nothing and lets an admin see and switch the
--   account on from /admin/staff. The NOTICE lines report the inventory.
--
-- Safe to apply twice. Rollback: recreate "Authenticated users can view
-- profiles" exactly as in 20260430124552 (that would reopen the leak) and
-- "Admins can update profiles." as in the baseline (which, with the kit's
-- policies in place, brings the 42P17 back).

drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Authenticated users can view profiles" on public.profiles;

-- "Admins can update profiles." (baseline) decides who is an admin with a
-- subquery on profiles itself. The kit's profile policies wrap their function
-- calls in (select ...), which is a sublink, and Postgres refuses a profiles
-- policy with a sublink while it is already expanding a profiles policy:
-- every UPDATE of profiles by a signed-in account failed with 42P17
-- ("infinite recursion detected in policy"), found by
-- supabase/tests/kit-auth.test.sql. Same name, same meaning, but the admin
-- check is now is_active_admin(), which is SECURITY DEFINER and reads
-- profiles without RLS. Roles and access flags stay out of reach of every
-- signed-in account, an admin included: the kit_profiles_guard trigger
-- refuses them, so an admin can only change columns such as email this way.
drop policy if exists "Admins can update profiles." on public.profiles;
create policy "Admins can update profiles."
  on public.profiles for update
  to authenticated
  using ((select public.is_active_admin()))
  with check ((select public.is_active_admin()));

-- Backfill: existing staff stay active. Nothing to write: deactivated_at is
-- added null on every row by 20261107090000, and only the kit's leaver action
-- sets it (with role pending). The inventory below counts the active staff.

-- Backfill: every Auth user has a profile row, pending when it had none.
insert into public.profiles (id, email, role)
select u.id, u.email, 'pending'::public.user_role
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

do $$
declare
  v_admins integer;
  v_hosts integer;
  v_pending integer;
  v_orphans integer;
begin
  select count(*) into v_admins from public.profiles where role = 'admin' and deactivated_at is null;
  select count(*) into v_hosts from public.profiles where role = 'host' and deactivated_at is null;
  select count(*) into v_pending from public.profiles where role = 'pending' or deactivated_at is not null;
  select count(*) into v_orphans from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
  raise notice 'kit_auth_cash_profiles: % active admin(s), % active host(s), % without access, % auth user(s) without a profile',
    v_admins, v_hosts, v_pending, v_orphans;
  if v_orphans <> 0 then
    raise exception 'kit_auth_cash_profiles: % auth user(s) still have no profile row', v_orphans;
  end if;
end;
$$;

-- Cash Bingo's convention since 20260929103018: every public function is
-- executable by the service role, in production's default privileges and in
-- a project created today alike. The kit grants these two to nobody (they
-- run only inside the kit's SECURITY DEFINER functions and as a trigger), so
-- a rebuilt project would differ from production without this. The Before
-- User Created hook is the one deliberate exception: only Supabase Auth.
grant execute on function public.kit_profile_role_type() to service_role;
grant execute on function public.kit_profiles_guard() to service_role;
