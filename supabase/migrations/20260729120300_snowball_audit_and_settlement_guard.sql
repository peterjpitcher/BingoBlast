-- Migration: let the snowball audit trail be written, and make it the
-- once-per-game settlement guard.
--
-- Two money defects sit behind this, both additive to fix.
--
--   1. snowball_pot_history has RLS enabled with a SELECT policy ("Admins view
--      history") and no INSERT policy at all, so every audit insert from
--      handleSnowballPotUpdate was rejected. The table holds zero rows while the
--      live pot has demonstrably rolled over six times. Worse, the host action
--      read that rejection as "the pot did not update" and told the host to go
--      and correct a pot that was already right.
--
--   2. Nothing recorded that a given game had settled its pot. A completed game
--      re-opened from the host dashboard and ended again rolled the pot a second
--      time, inventing jackpot cash out of nothing.
--
-- The fix for (2) reuses the audit row as the settlement claim: snowball_pot_history
-- gains game_id, and a unique index on (snowball_pot_id, game_id) means the
-- second settlement attempt for the same game raises 23505 instead of moving the
-- pot again. src/app/host/actions.ts inserts the audit row FIRST for exactly this
-- reason, and treats 23505 as "already settled, leave the pot alone".
--
-- game_id is nullable and the index is partial so the existing historical rows,
-- which have no game_id, and any manual admin adjustment, which belongs to no
-- game, all remain valid.
--
-- Everything here is additive and re-runnable. Nothing is dropped, no data moves.

-- 1. The settlement claim column.
alter table public.snowball_pot_history
  add column if not exists game_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'snowball_pot_history_game_id_fkey'
       and conrelid = 'public.snowball_pot_history'::regclass
  ) then
    alter table public.snowball_pot_history
      add constraint snowball_pot_history_game_id_fkey
      foreign key (game_id) references public.games(id) on delete set null;
  end if;
end;
$$;

comment on column public.snowball_pot_history.game_id is
  'The game whose end settled the pot. Unique per pot (partial index below), which is what stops a re-ended game settling twice. Null on rows written before this column existed and on manual admin adjustments.';

-- 2. The guard itself. Partial, so multiple null-game_id rows stay legal.
create unique index if not exists snowball_pot_history_pot_game_unique
  on public.snowball_pot_history (snowball_pot_id, game_id)
  where game_id is not null;

-- 3. Let admins write the audit row. Mirrors the existing "Admins view history"
-- SELECT policy exactly, including the default public role, so the same accounts
-- that can update snowball_pots (admin-only) can record the change.
drop policy if exists "Admins insert history" on public.snowball_pot_history;

create policy "Admins insert history"
  on public.snowball_pot_history
  for insert
  with check (
    exists (
      select 1 from public.profiles
       where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );
