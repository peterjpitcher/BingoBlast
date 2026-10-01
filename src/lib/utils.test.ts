// src/lib/utils.test.ts
//
// tailwind-merge did not know the pub TV sizes (text-tv-*) and read them as
// text colours, so cn('text-tv-base', 'text-white') kept text-white and
// silently dropped the size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TV_FONT_SIZES, cn } from './utils';

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

test('the list matches the sizes in tailwind.config.ts', () => {
  const config = readFileSync(new URL('../../tailwind.config.ts', import.meta.url), 'utf8');
  const configured = [...config.matchAll(/"(tv-[a-z0-9]+)":\s*\[/g)].map((match) => match[1]);
  assert.deepEqual([...configured].sort(), [...TV_FONT_SIZES].sort());
});
