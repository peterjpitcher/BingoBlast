-- Migration: restrict profiles SELECT to authenticated users only.
--
-- The previous "Public profiles are viewable by everyone" policy used
-- using (true) with default role public, which allowed anonymous Supabase
-- clients to enumerate staff emails and roles. The login + admin + host
-- surfaces all read profiles in authenticated context, so restricting to
-- the authenticated role does not break any existing flow.

drop policy if exists "Public profiles are viewable by everyone." on public.profiles;

create policy "Authenticated users can view profiles"
  on public.profiles
  for select
  to authenticated
  using (true);
