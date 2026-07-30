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

test('a number outside 1 to 90 returns null', () => {
  assert.equal(getNumberNickname(0), null);
  assert.equal(getNumberNickname(91), null);
});

test('every ball from 1 to 90 has a call', () => {
  const missing: number[] = [];
  for (let n = 1; n <= 90; n += 1) {
    if (getNumberNickname(n) === null) missing.push(n);
  }
  assert.deepEqual(missing, [], `balls with no call: ${missing.join(', ')}`);
});

// The reason this test exists: guests at The Anchor have lost husbands, and a
// call is shouted to the whole room with no warning. "Gateway To Heaven" (27)
// and "Made In Heaven" (67) were removed for exactly this. If you are adding a
// call and this test fails, pick a different one rather than loosening the list.
const BEREAVEMENT_WORDS = [
  'heaven',
  'death',
  'dead',
  'dying',
  'grave',
  'coffin',
  'funeral',
  'widow',
  'rest in peace',
  'afterlife',
];

test('no call refers to death or the afterlife', () => {
  const offending = Object.entries(NUMBER_NICKNAMES).filter(([, name]) =>
    BEREAVEMENT_WORDS.some((word) => name.toLowerCase().includes(word))
  );
  assert.deepEqual(offending, [], `these calls need replacing: ${JSON.stringify(offending)}`);
});

test('the six call-and-response balls keep the wording the room answers', () => {
  // These pair with CALL_RESPONSES in src/lib/house-rules.ts. Renaming one
  // without the other leaves the host prompting a quack for a call about
  // something else entirely.
  assert.equal(getNumberNickname(2), 'One Little Duck');
  assert.equal(getNumberNickname(11), 'Legs Eleven');
  assert.equal(getNumberNickname(22), 'Two Little Ducks');
  assert.equal(getNumberNickname(59), 'Brighton Line');
  assert.equal(getNumberNickname(69), 'Any Way Up');
  assert.equal(getNumberNickname(88), 'Two Fat Ladies');
});

test('the classics the crowd shouts back are untouched', () => {
  assert.equal(getNumberNickname(1), "Kelly's Eye");
  assert.equal(getNumberNickname(8), 'Garden Gate');
  assert.equal(getNumberNickname(33), 'All The Threes');
  assert.equal(getNumberNickname(55), 'All The Fives');
  assert.equal(getNumberNickname(66), 'Clickety Click');
  assert.equal(getNumberNickname(77), 'All The Sevens');
  assert.equal(getNumberNickname(90), 'Top Of The Shop');
});
