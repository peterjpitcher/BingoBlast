// supabase/tests/claim-stage-counts.test.ts
//
// The claim functions in 20261001000200_claim_attempts.sql take the number of
// claimed numbers each stage needs from the SQL helper required_claim_count.
// The host screen takes it from REQUIRED_SELECTION_COUNT_BY_STAGE. If the two
// ever disagree, a claim the host screen accepts is refused by the server, or
// the other way round, in the middle of a night.
//
// The chain that keeps them equal:
//   claims.test.sql (npm run test:db) asserts required_claim_count equals the
//   block between STAGE_COUNTS_BEGIN and STAGE_COUNTS_END in that file;
//   this test (npm test) asserts that block equals win-stages.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REQUIRED_SELECTION_COUNT_BY_STAGE } from '../../src/lib/win-stages';

function readSqlStageCounts(): Record<string, number> {
  const sql = readFileSync(new URL('./claims.test.sql', import.meta.url), 'utf8');
  const block = sql.split('-- STAGE_COUNTS_BEGIN')[1]?.split('-- STAGE_COUNTS_END')[0];
  assert.ok(block, 'claims.test.sql has lost its STAGE_COUNTS_BEGIN / STAGE_COUNTS_END block');

  const counts: Record<string, number> = {};
  for (const match of block.matchAll(/\('([^']+)',\s*(\d+)\)/g)) {
    counts[match[1]] = Number(match[2]);
  }
  return counts;
}

test('the stage counts claims.test.sql checks the SQL helper against equal win-stages.ts', () => {
  assert.deepEqual(readSqlStageCounts(), { ...REQUIRED_SELECTION_COUNT_BY_STAGE });
});
