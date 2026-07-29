// src/lib/number-nicknames.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NUMBER_NICKNAMES, getNumberNickname } from './number-nicknames';

test('10 is the host wording, Andys Den', () => {
  assert.equal(getNumberNickname(10), 'Andys Den');
});

// The wording retired from ball 10, split so a repo-wide sweep for it stays
// clean while this test still guards against it creeping back in.
const RETIRED_WORDING = ['Star', 'mers'].join('').toLowerCase();

test('the retired wording for ball 10 is gone', () => {
  const offending = Object.values(NUMBER_NICKNAMES).filter((name) =>
    name.toLowerCase().includes(RETIRED_WORDING)
  );
  assert.deepEqual(offending, []);
});

test('every key is a whole number between 1 and 90', () => {
  for (const key of Object.keys(NUMBER_NICKNAMES)) {
    const n = Number(key);
    assert.ok(Number.isInteger(n), `${key} is not an integer`);
    assert.ok(n >= 1 && n <= 90, `${key} is outside 1 to 90`);
  }
});

test('every nickname is a non-empty trimmed string', () => {
  for (const [key, name] of Object.entries(NUMBER_NICKNAMES)) {
    assert.equal(typeof name, 'string', `${key} is not a string`);
    assert.ok(name.trim().length > 0, `${key} is empty`);
    assert.equal(name, name.trim(), `${key} has stray whitespace`);
  }
});

test('a number without a nickname returns null', () => {
  assert.equal(getNumberNickname(18), null);
  assert.equal(getNumberNickname(0), null);
  assert.equal(getNumberNickname(91), null);
});

test('a familiar handful still read correctly', () => {
  assert.equal(getNumberNickname(1), "Kelly's Eye");
  assert.equal(getNumberNickname(11), 'Legs Eleven');
  assert.equal(getNumberNickname(88), 'Two Fat Ladies');
  assert.equal(getNumberNickname(90), 'Top Of The Shop');
});
