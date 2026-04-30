// src/lib/prize-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGamePrizes } from './prize-validation';

test('standard game with full prize map passes', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line', 'Two Lines', 'Full House'],
    prizes: { Line: '£10', 'Two Lines': '£20', 'Full House': '£50' },
  });
  assert.deepEqual(r, { valid: true });
});

test('standard game with one missing stage prize fails', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line', 'Two Lines', 'Full House'],
    prizes: { Line: '£10', 'Two Lines': '', 'Full House': '£50' },
  });
  assert.equal(r.valid, false);
  assert.deepEqual((r as { valid: false; missingStages: string[] }).missingStages, ['Two Lines']);
});

test('standard game with whitespace-only prize fails', () => {
  const r = validateGamePrizes({
    type: 'standard',
    stage_sequence: ['Line'],
    prizes: { Line: '   ' },
  });
  assert.equal(r.valid, false);
});

test('snowball game requires Full House prize', () => {
  const ok = validateGamePrizes({
    type: 'snowball',
    stage_sequence: ['Full House'],
    prizes: { 'Full House': '£100' },
  });
  assert.deepEqual(ok, { valid: true });

  const bad = validateGamePrizes({
    type: 'snowball',
    stage_sequence: ['Full House'],
    prizes: { 'Full House': '' },
  });
  assert.equal(bad.valid, false);
});

test('jackpot game with empty admin prizes is allowed (host enters at start)', () => {
  const r = validateGamePrizes({
    type: 'jackpot',
    stage_sequence: ['Full House'],
    prizes: {},
  });
  assert.deepEqual(r, { valid: true });
});
