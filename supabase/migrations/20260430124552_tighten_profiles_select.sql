-- Migration: restrict profiles SELECT to authenticated users only.
--
-- The previous "Public profiles are viewable by everyone" policy used
-- using (true) with default role public, which allowed anonymous Supabase
-- clients to enumerate staff emails and roles. The login + admin + host
-- surfaces all read profiles in authenticated context, so restricting to
-- the authenticated role does not break any existing flow.

drop policy if exists "Public profiles are viewable by everyone." on public.profiles;

-- IDEMPOTENCY GUARD ADDED 2026-08-25. The `create policy` below had no matching
-- drop, so re-running this file raised "policy already exists". It is the only
-- non-idempotent migration in the whole history, found by applying every
-- migration twice in supabase/tests/run.sh.
--
-- Safe to change even though this migration is already applied to production:
-- the added line is a no-op on a database that does not have the policy, and
-- production will never re-run this file anyway. The end state is byte for byte
-- what it was. Nothing else in the file is touched.
drop policy if exists "Authenticated users can view profiles" on public.profiles;

create policy "Authenticated users can view profiles"
  on public.profiles
  for select
  to authenticated
  using (true);
