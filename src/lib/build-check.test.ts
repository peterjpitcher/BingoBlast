// src/lib/build-check.test.ts
//
// A pub TV never reloads on its own, so it ran whatever release was live when
// somebody last touched it. The build check lets it pick up a new release, but
// only at a moment when a reload cannot hide a claim check or a win from the
// room, and never on a local build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBuildAction } from '@anchor-nights/kit/tv';
import { isPublicReloadSafe, type PublicReloadGameState } from './build-check';

// The generic decision (same build, dev builds, reload, prompt, wait) is
// tested in the kit. These cover Cash Bingo's own rule for when it is safe.

// The TV and phones used to treat any moment that was not a claim check or a
// win as safe, so they reloaded in the middle of calling numbers.
const calling: PublicReloadGameState = {
  status: 'in_progress',
  on_break: false,
  paused_for_validation: false,
  display_win_type: null,
};

test('no game state at all (before the first game) is safe', () => {
  assert.equal(isPublicReloadSafe(null), true);
  assert.equal(isPublicReloadSafe(undefined), true);
});

test('a game that is not in progress is safe', () => {
  assert.equal(isPublicReloadSafe({ ...calling, status: 'not_started' }), true);
  assert.equal(isPublicReloadSafe({ ...calling, status: 'completed' }), true);
});

test('calling numbers is never safe', () => {
  assert.equal(isPublicReloadSafe(calling), false);
});

test('a break is safe', () => {
  assert.equal(isPublicReloadSafe({ ...calling, on_break: true }), true);
});

test('a claim check or a win is never safe, even on a break', () => {
  assert.equal(isPublicReloadSafe({ ...calling, paused_for_validation: true }), false);
  assert.equal(isPublicReloadSafe({ ...calling, display_win_type: 'line' }), false);
  assert.equal(isPublicReloadSafe({ ...calling, on_break: true, paused_for_validation: true }), false);
  assert.equal(isPublicReloadSafe({ ...calling, on_break: true, display_win_type: 'full_house' }), false);
});

test('with a new release, the public screens reload only at a safe moment', () => {
  const decide = (state: PublicReloadGameState | null) =>
    decideBuildAction({ clientBuild: 'abc', serverBuild: 'def', mode: 'auto', safe: isPublicReloadSafe(state) });
  assert.equal(decide(null), 'reload');
  assert.equal(decide({ ...calling, on_break: true }), 'reload');
  assert.equal(decide(calling), 'wait');
  assert.equal(decide({ ...calling, paused_for_validation: true }), 'wait');
});
