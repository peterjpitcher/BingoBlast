-- Migration: publish snowball_pots to Realtime, so the pot channels on the
-- public screens actually deliver.
--
-- Why this exists. /display and /player both open a postgres_changes UPDATE
-- channel on public.snowball_pots, filtered to the active game's pot
-- (display-ui.tsx and player-ui.tsx, fetchAndSubscribePot). The table was never
-- added to supabase_realtime, so those channels subscribe cleanly and receive
-- nothing. The 3 second poll does not re-read the pot either, so a pot moved by
-- settle_snowball_pot or by an admin correction on /admin/snowball reached a
-- screen only when the active game changed or the page was reloaded.
--
-- Why publishing is safe. Realtime checks every change against the
-- subscriber's own SELECT policy and column privileges before sending it
-- (realtime.apply_rls), so a subscriber receives exactly what it can already
-- read over the REST API with the same key. For snowball_pots that is every row
-- and every column, for anon and authenticated alike, through the existing
-- "Read access for all authenticated users" policy, which the pub TV relies on
-- (see supabase/anon-access-allowlist.ts). The columns are pot settings and
-- amounts, the same figures shown on the board in the room: no names, no user
-- ids, no personal data. A DELETE event carries only the id under the default
-- replica identity. So this adds no exposure the public key does not already
-- have. winners is the opposite case and stays unpublished (replay.test.sql).
--
-- Replica identity stays DEFAULT, which is the primary key. That matters: a
-- published table with no usable replica identity rejects every UPDATE, which
-- would break settle_snowball_pot. The screens read payload.new, which always
-- carries the full new row.
--
-- Nothing here changes a policy, a grant, a column or a row. Guarded like
-- 20260729231901, so it is safe to re-run and a no-op on a database without the
-- publication.
--
-- Rollback: alter publication supabase_realtime drop table public.snowball_pots;
-- The screens then fall back to what they did before: the pot is read when the
-- active game changes.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise notice 'publication supabase_realtime not found, skipping snowball_pots';
    return;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'snowball_pots'
  ) then
    alter publication supabase_realtime add table public.snowball_pots;
  end if;
end $$;
