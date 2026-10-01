// src/lib/postgrest-embeds.test.ts
//
// games and sessions are joined by two foreign keys (games.session_id and
// sessions.active_game_id), so PostgREST refuses an embed between them that
// does not name one: "more than one relationship was found". The admin backup
// page had such an embed and showed only its error state, in production too.
// Lint, typecheck and build cannot see this, so the source is scanned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// Every pair of tables joined by more than one foreign key. Checked against
// pg_constraint on a database built from the migrations (1 Oct 2026): this is
// the only pair. Add to it when a migration creates another.
const MULTI_KEY_PAIRS: ReadonlyArray<readonly [string, string]> = [['games', 'sessions']];

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function isMultiKeyPair(a: string, b: string): boolean {
  return MULTI_KEY_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Embeds in one select string that cross a multi-key pair without a `!constraint` hint. */
function unhintedEmbeds(fromTable: string, select: string): string[] {
  const found: string[] = [];
  const parents = [fromTable];
  const token = /(?:\w+\s*:\s*)?(\w+)(!\w+)?\s*\(|\)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(select))) {
    if (match[0] === ')') {
      parents.pop();
      continue;
    }
    const [, table, hint] = match;
    const parent = parents[parents.length - 1];
    if (!hint && isMultiKeyPair(parent, table)) found.push(`${parent} -> ${table}`);
    parents.push(table);
  }
  return found;
}

test('an embed between games and sessions without a hint is reported, nested or not', () => {
  assert.deepEqual(unhintedEmbeds('games', 'id, sessions:sessions (name)'), ['games -> sessions']);
  assert.deepEqual(unhintedEmbeds('sessions', '*, games(*)'), ['sessions -> games']);
  assert.deepEqual(unhintedEmbeds('winners', '*, game:games (name, sessions (name))'), ['games -> sessions']);
});

test('a hinted embed, and an embed between other tables, pass', () => {
  assert.deepEqual(unhintedEmbeds('games', 'id, sessions:sessions!games_session_id_fkey (name)'), []);
  assert.deepEqual(
    unhintedEmbeds('sessions', '*, games:games!games_session_id_fkey (*, game_states:game_states (*))'),
    [],
  );
  assert.deepEqual(unhintedEmbeds('winners', '*, session:sessions (name), game:games (name)'), []);
});

test('no select in src embeds games and sessions without naming the foreign key', () => {
  const problems: string[] = [];
  let embedsChecked = 0;

  for (const file of sourceFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    const selectCall = /\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
    let match: RegExpExecArray | null;
    while ((match = selectCall.exec(source))) {
      const select = match[1].slice(1, -1);
      if (!select.includes('(')) continue;

      // The table is the nearest .from('...') before the select.
      const before = source.slice(0, match.index);
      const from = [...before.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)].pop();
      const line = before.split('\n').length;
      const where = `${relative(SRC_DIR, file)}:${line}`;
      assert.ok(from, `${where}: could not find the table this select reads from`);

      embedsChecked += 1;
      for (const embed of unhintedEmbeds(from[1], select)) {
        problems.push(`${where}: ${embed} needs a !constraint_name hint`);
      }
    }
  }

  // Guards the scan itself: if it stops finding the embeds it proves nothing.
  assert.ok(embedsChecked >= 5, `expected to scan the embedded selects in src, found ${embedsChecked}`);
  assert.deepEqual(problems, []);
});
