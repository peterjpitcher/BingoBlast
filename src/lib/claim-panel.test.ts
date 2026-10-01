// src/lib/claim-panel.test.ts
//
// The copy asserted here is spec 5.2, word for word. The public wording must
// never say the ticket itself is valid: only the caller checks the paper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClaimPanelState, type ClaimPanelInput } from './claim-panel';

const CALLED = [12, 3, 45, 7];

const input = (overrides: Partial<ClaimPanelInput> = {}): ClaimPanelInput => ({
  paused: true,
  claimNumbers: null,
  claimResult: null,
  calledNumbers: [7, 22, 34, 51, 68, 45],
  stageName: 'Line',
  requiredCount: 5,
  ...overrides,
});

test('no panel when the game is not paused for a claim', () => {
  assert.equal(getClaimPanelState(input({ paused: false, claimNumbers: [7] })), null);
});

test('paused with an empty draft is waiting, with the exact copy', () => {
  const state = getClaimPanelState(input());
  assert.ok(state);
  assert.equal(state.kind, 'waiting');
  assert.equal(state.headline, 'Checking a Line claim');
  assert.equal(state.detail, 'Numbers appear as the caller reads them');
  assert.equal(state.lastNumberLine, 'Last number called: 45');
  assert.equal(state.lastNumber, 45);
  assert.deepEqual(state.balls, []);
});

test('an empty array is the same as no draft', () => {
  assert.equal(getClaimPanelState(input({ claimNumbers: [] }))?.kind, 'waiting');
});

test('the headline names the stage being claimed', () => {
  assert.equal(getClaimPanelState(input({ stageName: 'Two Lines' }))?.headline, 'Checking a Two Lines claim');
  assert.equal(getClaimPanelState(input({ stageName: 'Full House' }))?.headline, 'Checking a Full House claim');
  assert.equal(getClaimPanelState(input({ stageName: null }))?.headline, 'Checking a claim');
});

test('a live draft shows the balls in tap order, ticked or crossed, and the count read out', () => {
  const state = getClaimPanelState(input({ claimNumbers: [45, 7, 80] }));
  assert.ok(state);
  assert.equal(state.kind, 'draft');
  assert.deepEqual(state.balls, [
    { n: 45, called: true, isLast: true },
    { n: 7, called: true, isLast: false },
    { n: 80, called: false, isLast: false },
  ]);
  assert.equal(state.headline, 'Checking a Line claim');
  assert.equal(state.detail, '3 of 5 numbers read out');
  assert.equal(state.lastNumberLine, 'Last number called: 45');
  assert.deepEqual(state.invalidNumbers, [80]);
});

test('a draft with an unknown stage count still reads sensibly', () => {
  assert.equal(getClaimPanelState(input({ claimNumbers: [7], requiredCount: null }))?.detail, '1 number read out');
  assert.equal(getClaimPanelState(input({ claimNumbers: [7, 22], requiredCount: null }))?.detail, '2 numbers read out');
});

test('a valid verdict ticks every ball and says the caller is checking the ticket', () => {
  const state = getClaimPanelState(
    input({ claimNumbers: [7, 22, 34, 51, 45], claimResult: 'valid' })
  );
  assert.ok(state);
  assert.equal(state.kind, 'valid');
  assert.ok(state.balls.every((ball) => ball.called));
  assert.equal(state.detail, 'All 5 numbers have been called. The caller is checking the ticket.');
  assert.equal(state.lastNumberLine, null);
  assert.doesNotMatch(`${state.headline} ${state.detail}`, /valid|winner/i);
});

test('an invalid verdict names the number that has not been called', () => {
  const state = getClaimPanelState(
    input({ claimNumbers: [12, 3, 61, 45, 7], claimResult: 'invalid', calledNumbers: [12, 3, 45, 7] })
  );
  assert.ok(state);
  assert.equal(state.kind, 'invalid');
  assert.equal(state.headline, 'Line claim');
  assert.equal(state.detail, 'Not a winner this time: 61 has not been called. The game carries on.');
  assert.deepEqual(state.invalidNumbers, [61]);
  assert.equal(state.balls.find((ball) => ball.n === 61)?.called, false);
  assert.equal(state.lastNumberLine, null);
});

test('an invalid verdict lists two or more uncalled numbers in tap order', () => {
  const two = getClaimPanelState(
    input({ claimNumbers: [61, 3, 72, 12, 45], claimResult: 'invalid', calledNumbers: CALLED })
  );
  assert.equal(two?.detail, 'Not a winner this time: 61 and 72 have not been called. The game carries on.');

  const three = getClaimPanelState(
    input({ claimNumbers: [61, 3, 72, 80, 45], claimResult: 'invalid', calledNumbers: CALLED })
  );
  assert.equal(three?.detail, 'Not a winner this time: 61, 72 and 80 have not been called. The game carries on.');
});

test('an invalid verdict with every number called still reads correctly', () => {
  const state = getClaimPanelState(
    input({ claimNumbers: [12, 3, 45, 7], claimResult: 'invalid', calledNumbers: CALLED })
  );
  assert.equal(state?.detail, 'Not a winner this time. The game carries on.');
});

test('a late verdict names the last number the claim had to include', () => {
  const state = getClaimPanelState(
    input({ claimNumbers: [7, 22, 34, 51, 68], claimResult: 'late' })
  );
  assert.ok(state);
  assert.equal(state.kind, 'late');
  assert.equal(state.headline, 'Line claim');
  assert.equal(state.detail, 'Too late: the claim had to include 45. The game carries on.');
  assert.equal(state.lastNumberLine, null);
  assert.ok(state.balls.every((ball) => ball.called && !ball.isLast));
});

test('before any ball is called there is no last number line', () => {
  const state = getClaimPanelState(input({ calledNumbers: [] }));
  assert.equal(state?.lastNumber, null);
  assert.equal(state?.lastNumberLine, null);
});

test('the verdict comes from claim_result even while balls are still shown', () => {
  const state = getClaimPanelState(input({ claimNumbers: [7], claimResult: 'invalid', calledNumbers: [] }));
  assert.equal(state?.kind, 'invalid');
});

test('rubbish in the claim list is dropped rather than drawn as a ball', () => {
  const state = getClaimPanelState(
    input({ claimNumbers: [7, Number.NaN, 2.5, 22] as number[] })
  );
  assert.deepEqual(state?.balls.map((ball) => ball.n), [7, 22]);
});
