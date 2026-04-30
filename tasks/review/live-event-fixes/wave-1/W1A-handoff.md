# W1A — DB Foundations: Handoff

## Status: complete (staged, not committed)

## Files created or modified

| Path | Action |
|------|--------|
| `supabase/migrations/20260430120000_add_state_version.sql` | NEW |
| `supabase/migrations/20260430120100_set_call_delay_default_2.sql` | NEW |
| `scripts/audit-missing-prizes.sql` | NEW |
| `docs/schema.sql` | MODIFIED |
| `src/types/database.ts` | MODIFIED |
| `tasks/review/live-event-fixes/wave-1/W1A-handoff.md` | NEW (this file) |

Both migration files have been applied to the live Supabase project (`bcmorqsgeumtmhvctvgu`) via the Supabase MCP `apply_migration` tool. They are now recorded in `supabase_migrations.schema_migrations` alongside the existing migrations.

## Verification SQL output

### 1. Column listing on both tables

```sql
select table_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in ('game_states','game_states_public')
  and column_name in ('state_version','call_delay_seconds')
order by table_name, column_name;
```

Result:

| table_name | column_name | data_type | column_default | is_nullable |
|------------|-------------|-----------|----------------|-------------|
| game_states | call_delay_seconds | integer | 2 | YES |
| game_states | state_version | bigint | 0 | NO |
| game_states_public | call_delay_seconds | integer | 2 | YES |
| game_states_public | state_version | bigint | 0 | NO |

Both tables now carry `state_version bigint not null default 0` and `call_delay_seconds integer default 2`. Matches the plan's expected output.

### 2. Trigger listing on `game_states`

```sql
select tgname from pg_trigger
where tgrelid = 'public.game_states'::regclass
  and not tgisinternal
order by tgname;
```

Result:

```
bump_game_state_version
on_game_states_delete
on_game_states_upsert
```

`bump_game_state_version` is present, alongside the existing two sync triggers. Confirms the BEFORE UPDATE trigger that increments `state_version`.

### 3. Default value query (plan's verification)

```sql
select column_default from information_schema.columns
where table_schema='public' and table_name='game_states' and column_name='call_delay_seconds';
```

Result: `2`. Matches plan expected output.

## Audit SQL output (`scripts/audit-missing-prizes.sql`)

Ran the audit query against the live DB. One pre-existing missing-prize row was found:

| id | name | type | stage |
|----|------|------|-------|
| bf8bdbd3-cd38-4283-bcb7-a93e18f5d06d | Game 4 - Peach | standard | Line |

This is pre-existing data, not caused by this wave. Per the plan, hosts should manually fix this row in admin before the next live event. The audit script is now in place for future pre-release runs.

## Assumptions and surprises

1. **`sync_game_states_public()` DELETE branch preserved.** The plan's example body (lines 100-161 of the plan) drops the `if (tg_op = 'DELETE')` branch. The existing migration `20251221101438_add_game_states_public.sql` includes it. The brief explicitly says "preserve every column it currently copies" — I extended that intent to "preserve the existing structure and add `state_version`". Both the migration file and `docs/schema.sql` now keep the DELETE branch in place. The new `bump_game_state_version` trigger is `BEFORE UPDATE` only, so DELETE is irrelevant for it.

2. **Pre-existing migration `20260218190500_set_call_delay_to_1_second.sql` is on disk but not applied to remote.** Before my work the remote default was `8` (not `1`). My A2 migration sets the default to `2` and updates rows where `call_delay_seconds = 1` — so any rows still at `8` are NOT touched (they retain `8`). This matches the plan literally. If the orchestrator wants existing `8` rows reset to `2`, that's a separate decision out of W1A scope. The new default of `2` will apply to any newly-created rows.

3. **`WinStage` and `GameType` already exported.** The brief asked me to "export `WinStage` and `GameType` if not already exported". They are already exported as standalone types at lines 11-13 of `src/types/database.ts`. No change needed.

4. **`npx tsc --noEmit` passes cleanly.** Zero errors after the type changes.

5. **Structural-change hook fired twice** (once per migration file) — flagged here per its instruction. Future session may want to run `/session-setup partial` to refresh docs.

## Files staged via git add (NOT committed)

```
supabase/migrations/20260430120000_add_state_version.sql
supabase/migrations/20260430120100_set_call_delay_default_2.sql
scripts/audit-missing-prizes.sql
docs/schema.sql
src/types/database.ts
tasks/review/live-event-fixes/wave-1/W1A-handoff.md
```

Per the orchestrator's override of plan task A1 step 4 / A7 step 5 / B5 step 3, no commit was created. Files are in the staging area only and ready for orchestrator review.

## What downstream agents can rely on

- `state_version` column exists on both `game_states` and `game_states_public`, defaults to `0`, and is incremented by the `bump_game_state_version` BEFORE UPDATE trigger on `game_states`.
- The sync trigger now copies `state_version` to `game_states_public` on every insert/update.
- TypeScript shape for `Database['public']['Tables']['game_states']['Row']` and `game_states_public['Row']` includes `state_version: number`. Insert/Update variants include `state_version?: number`.
- `call_delay_seconds` default is now `2` for any new rows; existing rows that were at `1` were promoted to `2`. Rows at `8` (or any other value) untouched per plan.
- `WinStage` and `GameType` exported as standalone types at the top of `src/types/database.ts`.
- `scripts/audit-missing-prizes.sql` ready for hosts to paste into Supabase SQL editor.
