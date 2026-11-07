// src/lib/utils.test.ts
//
// tailwind-merge did not know the pub TV sizes (text-tv-*) and read them as
// text colours, so cn('text-tv-base', 'text-white') kept text-white and
// silently dropped the size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BRAND_RADII, BRAND_SHADOWS, TV_FONT_SIZES, cn } from './utils';

test('a TV size and a text colour are both kept', () => {
  assert.equal(cn('text-tv-base', 'text-white'), 'text-tv-base text-white');
  assert.equal(cn('text-white', 'text-tv-xs'), 'text-white text-tv-xs');
});

test('a later TV size replaces an earlier one', () => {
  assert.equal(cn('text-tv-base', 'text-tv-lg'), 'text-tv-lg');
});

test('a TV size and a standard size conflict like any two sizes', () => {
  assert.equal(cn('text-tv-sm', 'text-xl'), 'text-xl');
  assert.equal(cn('text-xl', 'text-tv-2xl'), 'text-tv-2xl');
});

test('every TV size is known, and colours still merge as before', () => {
  for (const size of TV_FONT_SIZES) {
    assert.equal(cn(`text-${size}`, 'text-slate-400'), `text-${size} text-slate-400`, size);
  }
  assert.equal(cn('text-white', 'text-slate-400'), 'text-slate-400');
});

test('the brand radius and shadow names merge like the built-in ones', () => {
  assert.equal(cn('rounded-card', 'rounded-full'), 'rounded-full');
  assert.equal(cn('rounded-full', 'rounded-input'), 'rounded-input');
  assert.equal(cn('shadow-gold', 'shadow-lift'), 'shadow-lift');
  // A colour and a brand shadow are different things and both stay.
  assert.equal(cn('shadow-gold', 'text-anchor-sage'), 'shadow-gold text-anchor-sage');
});

// cn() comes from the kit, and the sizes, radii and shadows from the kit's
// tokens.css. If the kit adds a name to one and not the other, cn() would
// silently drop a class on these screens, so the two are checked here too.
const tokensCss = readFileSync(fileURLToPath(import.meta.resolve('@anchor-nights/kit/tokens.css')), 'utf8');
const themeNames = (prefix: string): string[] =>
  [...tokensCss.matchAll(new RegExp(`^\\s*--${prefix}-([a-z0-9-]+):`, 'gm'))]
    .map((match) => match[1])
    .filter((name) => !name.includes('--'));

test('the TV size list matches the kit tokens', () => {
  const sizes = themeNames('text').filter((name) => name.startsWith('tv-') && !name.endsWith('-line-height'));
  assert.deepEqual([...new Set(sizes)].sort(), [...TV_FONT_SIZES].sort());
});

test('the brand radius and shadow lists match the kit tokens', () => {
  assert.deepEqual(themeNames('radius').sort(), [...BRAND_RADII].sort());
  assert.deepEqual(themeNames('shadow').sort(), [...BRAND_SHADOWS].sort());
});
