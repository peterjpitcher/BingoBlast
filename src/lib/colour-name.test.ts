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

// The ten printed books, as the games are set in production and as the staff
// name them. Lilac and peach used to come back as "White", orange as "Yellow".
test('each printed book gets the name the staff use for it', () => {
  const books: Array<[hex: string, name: string]> = [
    ['#ffa73a', 'Orange'],
    ['#9ca3af', 'Grey'],
    ['#3a7dff', 'Blue'],
    ['#ffbfa3', 'Peach'],
    ['#ffd93b', 'Yellow'],
    ['#e23b3b', 'Red'],
    ['#c8a2ff', 'Lilac'],
    ['#8b5a2b', 'Brown'],
    ['#ff66b3', 'Pink'],
    ['#28a745', 'Green'],
  ];
  for (const [hex, name] of books) {
    assert.equal(getColourName(hex), name, hex);
    assert.equal(getColourName(hex.toUpperCase()), name, hex.toUpperCase());
  }
  // No two books share a name: the name is how a colour-blind host tells them apart.
  assert.equal(new Set(books.map(([hex]) => getColourName(hex))).size, books.length);
});

test('a white or black book is still named, and is never mistaken for a printed one', () => {
  assert.equal(getColourName('#ffffff'), 'White');
  assert.equal(getColourName('#fafafa'), 'White');
  assert.equal(getColourName('#111111'), 'Black');
});
