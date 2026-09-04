/**
 * Guards what the public anon key can reach in the live database.
 *
 * The reviewed state lives in supabase/anon-access-allowlist.ts. This file reads
 * the live catalogue and fails when the database grants anon anything that file
 * does not allow.
 *
 * HOW TO RUN IT AGAINST A REAL PROJECT
 *   SUPABASE_DB_URL='postgresql://...' npx tsx --test tests/anon-access.test.ts
 *
 *   The connection string is the direct Postgres URL from the Supabase dashboard
 *   under Project Settings, Database. DATABASE_URL is accepted as an alias.
 *
 * WITHOUT A CONNECTION STRING IT SKIPS, ON PURPOSE
 *   `npm test` must stay runnable offline and must not need production
 *   credentials, so the live check is opt-in and says out loud that it skipped
 *   and why. Nothing else in `npm test` touches a database. The rest of this file
 *   is pure and always runs, so the comparison rules themselves are proven even
 *   when the live check does not run.
 *
 * IT CANNOT CHANGE ANYTHING
 *   One SELECT, and the session is forced read-only through PGOPTIONS, so a
 *   mistake here cannot write to the database it is inspecting. psql is used
 *   rather than a driver because supabase/tests/run.sh already depends on it and
 *   this repository has no Postgres client in its dependencies.
 */

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  ANON_ALLOWLIST,
  ANON_CATALOGUE_QUERY,
  ANON_OPEN_ITEMS,
  NEVER_ALLOWLIST,
  describeAnonAccessFindings,
  diffAnonAccess,
  type AnonCatalogueEntry,
} from '../supabase/anon-access-allowlist';

// ---------------------------------------------------------------------------
// Reaching the live database, or explaining why we are not going to.
// ---------------------------------------------------------------------------

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? '';

function psqlAvailable(): boolean {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * Why the live check is not running, or `false` when it is. Node's test runner
 * prints this string next to the skipped test, which is the whole point: a
 * silent skip is indistinguishable from a pass.
 */
function liveCheckSkipReason(): string | false {
  if (!connectionString) {
    return 'no database connection configured. Set SUPABASE_DB_URL (or DATABASE_URL) to the project\'s direct Postgres URL to run the live anon-grant check. Skipping is expected offline and in CI.';
  }
  if (!psqlAvailable()) {
    return 'SUPABASE_DB_URL is set but psql is not on PATH, so the live catalogue cannot be read. Install the Postgres client (brew install libpq, or apt-get install postgresql-client).';
  }
  return false;
}

function readLiveCatalogue(): AnonCatalogueEntry[] {
  const result = spawnSync(
    'psql',
    ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', ANON_CATALOGUE_QUERY, connectionString],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // Belt and braces: this session cannot write, whatever the query says.
        PGOPTIONS: '-c default_transaction_read_only=on',
        PGCONNECT_TIMEOUT: '15',
      },
    },
  );

  if (result.error) {
    throw new Error(`could not run psql: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `psql exited ${result.status} while reading the anon catalogue.\n${result.stderr?.trim() ?? ''}`,
    );
  }

  const output = result.stdout.trim();
  if (!output) {
    throw new Error('psql returned no rows for the anon catalogue query, which should be impossible');
  }

  return JSON.parse(output) as AnonCatalogueEntry[];
}

// ---------------------------------------------------------------------------
// The live check.
// ---------------------------------------------------------------------------

test(
  'anon can reach nothing beyond supabase/anon-access-allowlist.ts',
  { skip: liveCheckSkipReason() },
  (t: TestContext) => {
    const reachable = readLiveCatalogue();

    t.diagnostic(
      `live catalogue: anon can reach ${reachable.length} object(s) in schema public`,
    );

    const { findings, stale } = diffAnonAccess(reachable);

    for (const key of stale) {
      t.diagnostic(
        `allowlist entry no longer reachable by anon: ${key}. The database got tighter; trim the allowlist.`,
      );
    }

    assert.equal(findings.length, 0, describeAnonAccessFindings(findings));
  },
);

// ---------------------------------------------------------------------------
// Rules about the allowlist itself. These need no database and always run.
// ---------------------------------------------------------------------------

test('the allowlist never contains a money-moving or host-only function', () => {
  const banned = new Set(NEVER_ALLOWLIST);

  const offenders = ANON_ALLOWLIST.filter((entry) => {
    if (entry.kind !== 'function') return false;
    const bareName = entry.name.split('(')[0];
    return banned.has(bareName);
  }).map((entry) => entry.name);

  assert.deepEqual(
    offenders,
    [],
    `These are host-only, admin-only or money-moving functions and must never be allowlisted for anon: ${offenders.join(', ')}. If the live database grants one of them, write a migration that revokes it from PUBLIC and anon. Do not add it here.`,
  );
});

test('every allowlist entry carries a reason and at least one privilege', () => {
  for (const entry of ANON_ALLOWLIST) {
    assert.ok(entry.why.trim().length > 0, `${entry.kind} ${entry.name} has no reason recorded`);
    assert.ok(
      entry.privileges.length > 0,
      `${entry.kind} ${entry.name} is allowlisted with no privileges, so it should be removed`,
    );
  }
});

test('an open item is never also allowlisted, because that would bless it', () => {
  const allowed = new Set(ANON_ALLOWLIST.map((entry) => `${entry.kind} ${entry.name}`));
  for (const item of ANON_OPEN_ITEMS) {
    assert.equal(
      allowed.has(`${item.kind} ${item.name}`),
      false,
      `${item.kind} ${item.name} is recorded as an unresolved open item and must not appear in ANON_ALLOWLIST`,
    );
  }
});

// ---------------------------------------------------------------------------
// The comparison rules, proven with fixtures so they hold even when the live
// check skips. Without these, an offline run proves nothing at all.
// ---------------------------------------------------------------------------

const fixtureAllowlist = [
  { kind: 'table' as const, name: 'games', privileges: ['SELECT'], why: 'display needs it' },
];

test('diffAnonAccess passes when the live state matches the allowlist', () => {
  const { findings, stale } = diffAnonAccess(
    [{ kind: 'table', name: 'games', privileges: ['SELECT'] }],
    fixtureAllowlist,
    [],
  );

  assert.deepEqual(findings, []);
  assert.deepEqual(stale, []);
});

test('diffAnonAccess flags an object anon reaches that is not allowlisted', () => {
  const { findings } = diffAnonAccess(
    [
      { kind: 'table', name: 'games', privileges: ['SELECT'] },
      { kind: 'function', name: 'settle_snowball_pot(p_game_id uuid)', privileges: ['EXECUTE'] },
    ],
    fixtureAllowlist,
    [],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].problem, 'unlisted');
  assert.equal(findings[0].name, 'settle_snowball_pot(p_game_id uuid)');
  assert.ok(describeAnonAccessFindings(findings).includes('settle_snowball_pot'));
});

test('diffAnonAccess flags a listed object whose privileges have widened', () => {
  const { findings } = diffAnonAccess(
    [{ kind: 'table', name: 'games', privileges: ['SELECT', 'UPDATE', 'DELETE'] }],
    fixtureAllowlist,
    [],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].problem, 'widened');
  assert.deepEqual(findings[0].extraPrivileges, ['DELETE', 'UPDATE']);
});

test('a function overload cannot hide behind a sibling with the same name', () => {
  const { findings } = diffAnonAccess(
    [
      { kind: 'function', name: 'f(a uuid)', privileges: ['EXECUTE'] },
      { kind: 'function', name: 'f(a uuid, b uuid)', privileges: ['EXECUTE'] },
    ],
    [{ kind: 'function', name: 'f(a uuid)', privileges: ['EXECUTE'], why: 'fixture' }],
    [],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, 'f(a uuid, b uuid)');
});

test('a known open item still fails, but says it is known', () => {
  const { findings } = diffAnonAccess(
    [{ kind: 'function', name: 'stray(x jsonb)', privileges: ['EXECUTE'] }],
    [],
    [{ kind: 'function', name: 'stray(x jsonb)', why: 'reviewed, revoke pending an owner decision' }],
  );

  assert.equal(findings.length, 1, 'an open item must still fail the test, not be excused by it');
  assert.equal(findings[0].knownOpenItem, 'reviewed, revoke pending an owner decision');
  assert.ok(describeAnonAccessFindings(findings).includes('reviewed, revoke pending an owner decision'));
});

test('diffAnonAccess reports an allowlist entry the database no longer grants', () => {
  const { findings, stale } = diffAnonAccess([], fixtureAllowlist, []);

  assert.deepEqual(findings, [], 'a tighter database is not a failure');
  assert.deepEqual(stale, ['table games']);
});
