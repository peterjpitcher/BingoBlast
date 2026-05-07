import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getColourName } from './colour-name';

test('returns canonical name for exact palette hex', () => {
  assert.equal(getColourName('#ffffff'), 'White');
  assert.equal(getColourName('#000000'), 'Black');
  assert.equal(getColourName('#16a34a'), 'Green');
  assert.equal(getColourName('#dc2626'), 'Red');
});

test('returns nearest palette name for off-palette hex', () => {
  assert.equal(getColourName('#22c55e'), 'Green');
  assert.equal(getColourName('#fbbf24'), 'Yellow');
});

test('returns "Unknown colour" for invalid input', () => {
  assert.equal(getColourName(''), 'Unknown colour');
  assert.equal(getColourName('not-a-colour'), 'Unknown colour');
  assert.equal(getColourName('#fff'), 'Unknown colour');
  assert.equal(getColourName('#gggggg'), 'Unknown colour');
  assert.equal(getColourName('ffffff'), 'Unknown colour'); // missing leading #
});
