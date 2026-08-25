-- Replaces the real customer names in `winners` with 'Anonymous'.
--
-- APPROVED BY THE OWNER on 2026-08-25, in response to the finding below.
--
-- WHY
--   The app records winners anonymously and has done for months. CLAUDE.md says
--   so plainly. But 43 of the 87 rows in production carry a real customer first
--   name, 19 distinct names, recorded between 18 February and 29 April 2026,
--   before the anonymisation policy reached the code. Nobody dealt with the rows
--   that already existed.
--
--   Until the migration that preceded this one, those names were readable by
--   anyone holding the public anon key, which ships in the JavaScript of every
--   /display and /player page. That exposure is closed. This closes the
--   underlying problem: the app should not be holding the names at all.
--
-- REVERSIBLE, FOR A WHILE, ON PURPOSE
--   The originals are copied into public.winners_name_archive first. Rewriting
--   customer data with no undo is exactly the kind of irreversible production
--   change this whole review has been arguing against, and the archive is what
--   makes this a change rather than a gamble.
--
--   But an archive of the names is still the names. It reduces the exposure, it
--   does not end it. So the archive is a holding step, not a destination:
--
--     FINAL STEP, to be run deliberately once the change has been seen to be
--     correct (a week, or after the next bingo night):
--
--       drop table public.winners_name_archive;
--
--   That is the point at which the app genuinely stops holding customer names,
--   and the claim in CLAUDE.md becomes true of the data as well as the code.
--
-- WHAT IS NOT LOST
--   Only the name. Every winner row keeps its stage, prize, prize value, share,
--   call count, void flag, timestamps and its link to the game and session. The
--   history screens, the payout totals and the audit trail are all unaffected,
--   because none of them uses the name for anything: the column has been
--   rendered as a bold label and nothing else.
--
-- IDEMPOTENT
--   Re-running archives nothing new (the archive is keyed on the winner id) and
--   updates nothing, because no row is left that is not already 'Anonymous'.
--
-- ROLLBACK, while the archive still exists
--   update public.winners w
--      set winner_name = a.original_name
--     from public.winners_name_archive a
--    where a.winner_id = w.id;

create table if not exists public.winners_name_archive (
  winner_id uuid primary key references public.winners(id) on delete cascade,
  original_name text not null,
  archived_at timestamptz not null default now(),
  archived_reason text not null
);

alter table public.winners_name_archive enable row level security;

-- Admin read only, and no write policy at all. The only writer is this
-- migration. Nothing in the application reads this table, and nothing should.
drop policy if exists "Admins view archived winner names" on public.winners_name_archive;
create policy "Admins view archived winner names"
  on public.winners_name_archive for select
  using (exists (select 1 from public.profiles
                  where profiles.id = auth.uid()
                    and profiles.role = 'admin'::public.user_role));

comment on table public.winners_name_archive is
  'Temporary holding table for customer names removed from winners on 2026-08-25, so the change is reversible. This table IS the personal data the change exists to remove, so it is a holding step and not a destination: drop it once the change has been seen to be correct.';

do $$
declare
  v_named int;
  v_archived int;
  v_remaining int;
begin
  select count(*) into v_named
    from public.winners
   where winner_name is distinct from 'Anonymous';

  if v_named = 0 then
    raise notice 'no named winners, nothing to anonymise';
    return;
  end if;

  insert into public.winners_name_archive (winner_id, original_name, archived_reason)
  select id, winner_name,
         'Anonymised 2026-08-25: the app records winners anonymously, and these rows predate that policy reaching the code.'
    from public.winners
   where winner_name is distinct from 'Anonymous'
  on conflict (winner_id) do nothing;

  get diagnostics v_archived = row_count;

  update public.winners
     set winner_name = 'Anonymous'
   where winner_name is distinct from 'Anonymous';

  -- The archive must have taken a copy of every row about to be rewritten, or
  -- this is not reversible and should not have happened.
  if v_archived < v_named then
    raise exception 'archived % of % named winners: refusing to anonymise what cannot be restored',
      v_archived, v_named;
  end if;

  select count(*) into v_remaining
    from public.winners
   where winner_name is distinct from 'Anonymous';

  if v_remaining <> 0 then
    raise exception '% winner rows still carry a name after anonymising', v_remaining;
  end if;

  raise notice 'anonymised % winner names, % archived', v_named, v_archived;
end
$$;

-- The column can now say what it means, without the caveat the previous
-- migration had to add.
comment on column public.winners.winner_name is
  'Always the literal ''Anonymous''. There is no UI input for a winner name, no server action accepts one, and record_winner_atomic writes the literal. The pub does not keep a record of who won, only that somebody did.';
