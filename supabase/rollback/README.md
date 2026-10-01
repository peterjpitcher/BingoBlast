# Rollback scripts

Each file restores the function definitions that a migration replaced. They change no data: a reset night, a settled snowball pot or a recorded winner stays as it is.

To roll the screens back to the release before the guest display work, apply `20261001075456_claim_enforcement.rollback.sql` first, then roll back in Vercel. See `docs/runbooks/backup-and-recovery.md`, section 7.

## File names and versions

The four guest display migrations were written as `20261001000100` to `20261001000400` and applied to production on 1 October 2026 through the Supabase migration tool, which records the time of application as the version. The files were then renamed to match production, so `supabase db push --dry-run` stays clean:

| Written as | Applied and now named | Migration |
|---|---|---|
| `20261001000100` | `20261001075034` | `night_lifecycle` |
| `20261001000200` | `20261001075215` | `claim_attempts` |
| `20261001000300` | `20261001075401` | `jackpot_components` |
| `20261001000400` | `20261001075456` | `claim_enforcement` |

The contents of the migration files were not changed by the rename, so each still matches what production ran byte for byte. Comments inside them still use the original numbers.
