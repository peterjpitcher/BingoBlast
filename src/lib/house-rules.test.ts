// src/lib/house-rules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_RULES, CALL_RESPONSES } from './house-rules';

test('HOUSE_RULES still has four entries', () => {
  // The display panel is height-budgeted, so adding a rule needs a screenshot
  // check rather than a quiet edit.
  assert.equal(HOUSE_RULES.length, 4);
});

test('HOUSE_RULES has exactly one closing rule', () => {
  const closing = HOUSE_RULES.filter((rule) => rule.variant === 'closing');
  assert.equal(closing.length, 1);
  assert.equal(closing[0], HOUSE_RULES[HOUSE_RULES.length - 1]);
});

test('every rule has an icon and at least one non-empty segment', () => {
  for (const rule of HOUSE_RULES) {
    assert.ok(rule.icon.length > 0);
    assert.ok(rule.segments.length > 0);
    for (const segment of rule.segments) {
      assert.ok(segment.text.trim().length > 0);
    }
  }
});

test('CALL_RESPONSES holds the six agreed numbers', () => {
  assert.deepEqual(
    CALL_RESPONSES.map((entry) => entry.number),
    [2, 11, 22, 59, 69, 88]
  );
});

test('CALL_RESPONSES is in ascending numeric order', () => {
  const numbers = CALL_RESPONSES.map((entry) => entry.number);
  const sorted = [...numbers].sort((a, b) => a - b);
  assert.deepEqual(numbers, sorted);
});

test('every call response is a non-empty string on a valid ball', () => {
  for (const entry of CALL_RESPONSES) {
    assert.ok(Number.isInteger(entry.number), `${entry.number} is not an integer`);
    assert.ok(entry.number >= 1 && entry.number <= 90, `${entry.number} is outside 1 to 90`);
    assert.ok(entry.response.trim().length > 0, `${entry.number} has no response`);
  }
});
