-- `winners` stops being readable by anyone holding the public key.
--
-- WHY, AND WHY THIS IS URGENT RATHER THAN TIDY
--   The policy was `for select using (true)` granted to `public`, so the anon
--   key, which ships in the JavaScript bundle of every /display and /player
--   page, could read the whole winners table with one request.
--
--   CLAUDE.md states that "winners.winner_name is always 'Anonymous'" and that
--   winners are "anonymised by policy". That is true of the code today and NOT
--   true of the data. Checked against production on 2026-08-25:
--
--     87 winner rows, of which 43 carry a real customer first name,
--     19 distinct names, recorded between 18 February and 29 April 2026.
--
--   So the app has been publishing a list of named pub customers, with what
--   they won and when, to anyone who viewed the page source. The anonymisation
--   policy was applied to the code at some point and the existing rows were
--   never dealt with.
--
--   `void_reason` is the same shape of risk going forwards: it is free text an
--   admin is asked to type when reversing a win, and "wrong person, it was
--   Margaret's book" is the obvious thing to write.
--
-- NOTHING PUBLIC NEEDS THIS
--   Verified by grep: neither display-ui.tsx, player-ui.tsx nor either public
--   page.tsx references `winners` at all. The win banner on the pub TV comes
--   from game_states_public.display_win_text, not from this table. The host and
--   admin screens read it as an authenticated user.
--
-- WHY NOT SIMPLY `to authenticated`
--   Because 'authenticated' now includes the 'pending' tier: an account that has
--   signed up and not been approved. Naming the staff roles explicitly is the
--   same predicate every other staff-facing policy in this schema uses, and it
--   means a pending account gets zero rows rather than the whole table.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   It does not touch the 43 existing names. Rewriting customer data in
--   production is the owner's decision, not a side effect of a security fix, and
--   it is not reversible. The statement to do it is in the review spec under the
--   staff and privacy runbook, ready to run once that decision is made. Closing
--   the read access is what stops the exposure either way.
--
-- ROLLBACK
--   drop policy "Staff can read winners" on public.winners;
--   create policy "Read access for all" on public.winners for select using (true);
--   Only do that if some out-of-band consumer turns out to read winners
--   anonymously, which nothing in this repository does.

drop policy if exists "Read access for all" on public.winners;
drop policy if exists "Staff can read winners" on public.winners;

create policy "Staff can read winners"
  on public.winners for select
  using (exists (select 1 from public.profiles
                  where profiles.id = auth.uid()
                    and profiles.role in ('admin'::public.user_role, 'host'::public.user_role)));

comment on column public.winners.winner_name is
  'Always the literal ''Anonymous'' for anything recorded by record_winner_atomic. 43 rows created before the anonymisation policy carry real customer first names; see the migration that closed public read access to this table.';

comment on column public.winners.void_reason is
  'Free text typed by an admin when reversing a win. Must not contain a customer name: the UI says so at the point of entry. Readable by staff only.';
