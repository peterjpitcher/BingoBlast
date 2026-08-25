# Runbook: backup and recovery

**Owner:** Pete. **Last reviewed:** 25 August 2026.

## The short version

The Supabase project is on the **Pro** plan (verified 25 August 2026, org
"Orange Jelly"), with **8 days of daily backups** and point-in-time recovery
**not** enabled.

Worst case, you lose up to 24 hours: one bingo night. That is accepted, because
a night can be rebuilt from the paper books and the pot is one number you can
type back in. Nobody has ever tested a restore, and section 4 explains why that
is a decision rather than an oversight.

If the database is actually lost, go straight to section 5.

## 1. What a session export is, and what it is not

`/admin/history` and the per-session screens are **reporting**. Even once a
proper export exists, it will be reporting too.

An export of a night's winners cannot restore:

- the staff accounts and their roles (they live in `auth`, not in your export),
- the snowball pot and its history,
- the row level security policies, the database functions, or the triggers,
- the realtime publication,
- any session other than the one exported.

Restoring the database is a different job with a different tool. Do not let a
CSV in a Downloads folder become the reason nobody checks the real backups. An
earlier version of the review spec called an export "the answer to what if the
database is lost", which was the most dangerous sentence in it.

## 2. What is actually protecting the data

| Layer | What it covers | Where it lives |
|---|---|---|
| Supabase daily backup | The whole database as at the backup point. **8 days retained** | Supabase dashboard, Database, Backups |
| Point in time recovery | Any moment, to the second, within the retention window | A paid add-on on Pro. **Not enabled**, deliberately |
| `supabase/migrations` in git | Every table, function, policy and grant, rebuildable from empty | This repository |
| `supabase/tests/run.sh` | Proof that those migrations still rebuild it. 38 migrations, 147 assertions | This repository, and CI |

Rows three and four matter more than people expect. The schema is not something
you need a backup to recover: it is in git and it is tested. What only a backup
can give you back is the **data**: the sessions, games, winners and the pot.

## 3. What the backups actually give you

- **Retention: 8 days of daily backups** (owner, 25 August 2026).
- **Point in time recovery: not enabled.** It is a paid add-on on Pro and nobody
  turned it on.

So the worst case is losing **up to 24 hours** of data: whatever happened between
the last nightly backup and the failure. On a Friday night that is one bingo
night's results.

Decision, 25 August 2026: that is accepted. A lost night is reconstructable from
the paper books, the pot can be corrected by hand on `/admin/snowball`, and
point in time recovery is not worth paying for to protect a few hours of pub
bingo results.

## 4. The restore drill

**Status: not run, and deliberately not scheduled** (owner, 25 August 2026).

The honest case for and against, so this is a decision rather than an oversight.

**Against doing it:** the thing a restore protects is the record of past bingo
nights and the current pot figure. Both are reconstructable. The winners are
written on paper on the night, and the pot is one number that can be typed back
in on `/admin/snowball`. Nobody is paid from this database and nothing legal
depends on it. Twenty minutes to rehearse recovering something you could rebuild
by hand in ten is a poor trade.

**For doing it:** restores fail more often than people expect, and you find out
at the worst moment. But that argument is much stronger for systems where the
data cannot be recreated. This one can.

So: not scheduled. The steps stay written down below because if the day ever
comes, reading them cold under pressure is the bad version. If the app ever
starts holding something that is NOT reconstructable from paper, this decision
should be revisited.

If you do decide to run it:

1. Supabase dashboard, **Database**, **Backups**. Pick the most recent backup.
2. Restore it into a **new project**, not over the top of production. Supabase
   offers this; if it does not for your plan, download the backup and restore it
   locally with `pg_restore` into a throwaway database.
3. Against the restored copy, check the four things that actually matter:

   ```sql
   -- The night's record survived
   select count(*) from public.winners;                    -- expect 87 or more
   select count(*) from public.sessions;                   -- expect 6 or more

   -- The money survived
   select name, current_max_calls, current_jackpot_amount from public.snowball_pots;

   -- The security survived. A restore that loses the policies is not a restore
   select count(*) from pg_policies where schemaname = 'public';

   -- The functions survived
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public';
   ```

4. Write down how long the whole thing took, end to end. That number is your
   real recovery time, and it is the only honest answer to "how long would we be
   down".
5. Delete the restored project.

Record the result here:

| Drill date | Backup used | Time to restore | Everything present? | Notes |
|---|---|---|---|---|
| _not run, see the decision above_ | | | | |

## 5. If the database is actually lost

In order. Do not skip step 1.

1. **Stop writing to it.** Take the app offline in Vercel, or at least stop
   anyone running a game. A half-working database that people keep using is
   harder to recover than a stopped one.
2. **Work out what you have.** Latest daily backup, and its timestamp. Anything
   after that timestamp is gone unless point in time recovery is enabled.
3. **Restore into a new project**, exactly as in the drill.
4. **Point the app at it.** Update `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel,
   and redeploy.
5. **Re-check the security settings**, because a new project does not inherit
   them: sign-up must be OFF, and the anon key changes so the old one stops
   working.
6. **Run the checks in section 4 step 3** against the live app, not just the
   database.
7. **Reconstruct anything lost since the backup** from the paper books. The
   snowball pot is the one that matters: if a night was lost, the pot may need a
   manual correction on `/admin/snowball`, which is now an audited action.

## 6. If only the schema is broken

For example a migration went wrong, but the data is fine. This is much easier and
does not need a backup:

```bash
npm run test:db        # proves the repo's migrations still rebuild from empty
npx supabase db push   # applies anything missing
```

The migrations in git are the source of truth for structure. That is what makes
the harness in `supabase/tests/` worth keeping green.
