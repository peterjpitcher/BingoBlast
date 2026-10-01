// src/lib/night-phase.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNightPhase, getInGameSubState, pickNextGame } from './night-phase';
import type { NightPhaseGameState, NightPhaseSession } from './night-phase';

const session = (overrides: Partial<NightPhaseSession> = {}): NightPhaseSession => ({
  status: 'running',
  started_at: '2026-11-18T19:19:00Z',
  ...overrides,
});

const state = (overrides: Partial<NightPhaseGameState> = {}): NightPhaseGameState => ({
  status: 'in_progress',
  on_break: false,
  paused_for_validation: false,
  display_win_type: null,
  ...overrides,
});

// Row 1: night_over wins over everything.
test('a completed session is night_over, even with a game still in progress', () => {
  assert.equal(getNightPhase({ session: session({ status: 'completed' }), activeGameState: state() }), 'night_over');
});

test('an empty completed session (no game ever started) is night_over', () => {
  assert.equal(
    getNightPhase({ session: session({ status: 'completed', started_at: null }), activeGameState: null }),
    'night_over'
  );
});

test('a night ended with unplayed games is night_over', () => {
  assert.equal(
    getNightPhase({ session: session({ status: 'completed' }), activeGameState: state({ status: 'not_started' }) }),
    'night_over'
  );
});

// Row 2: in_game.
test('an active game in progress is in_game', () => {
  assert.equal(getNightPhase({ session: session(), activeGameState: state() }), 'in_game');
});

test('in_game beats before_start when started_at has not arrived yet', () => {
  assert.equal(getNightPhase({ session: session({ started_at: null }), activeGameState: state() }), 'in_game');
});

test('a completed active game is not in_game', () => {
  assert.equal(
    getNightPhase({ session: session(), activeGameState: state({ status: 'completed' }) }),
    'between_games'
  );
});

// Row 3: before_start.
test('a ready session that has never started is before_start', () => {
  assert.equal(
    getNightPhase({ session: session({ status: 'ready', started_at: null }), activeGameState: null }),
    'before_start'
  );
});

test('"Start Session" with no game started yet is still before_start', () => {
  // The admin's Start Session sets running before any game has a state row.
  assert.equal(
    getNightPhase({ session: session({ status: 'running', started_at: null }), activeGameState: null }),
    'before_start'
  );
});

test('a draft session that has never started is before_start', () => {
  assert.equal(
    getNightPhase({ session: session({ status: 'draft', started_at: null }), activeGameState: null }),
    'before_start'
  );
});

test('a missing started_at (a row from before the column existed) counts as not started', () => {
  assert.equal(
    getNightPhase({ session: { status: 'ready', started_at: undefined }, activeGameState: null }),
    'before_start'
  );
});

// Row 4: between_games.
test('a started night with no active game is between_games', () => {
  assert.equal(getNightPhase({ session: session(), activeGameState: null }), 'between_games');
});

test('a night reopened by an admin after it ended is between_games', () => {
  assert.equal(
    getNightPhase({ session: session({ status: 'running' }), activeGameState: state({ status: 'completed' }) }),
    'between_games'
  );
});

test('a started session with a not_started game state is between_games', () => {
  assert.equal(
    getNightPhase({ session: session({ status: 'ready' }), activeGameState: state({ status: 'not_started' }) }),
    'between_games'
  );
});

// In-game sub-states.
test('a win on screen is the win sub-state, even while paused for the claim', () => {
  assert.equal(
    getInGameSubState(state({ paused_for_validation: true, display_win_type: 'line' })),
    'win'
  );
});

test('a paused game is the claim_check sub-state', () => {
  assert.equal(getInGameSubState(state({ paused_for_validation: true })), 'claim_check');
});

test('a game on a break is the break sub-state', () => {
  assert.equal(getInGameSubState(state({ on_break: true })), 'break');
});

test('otherwise the game is calling', () => {
  assert.equal(getInGameSubState(state()), 'calling');
});

// Next game.
const games = [
  { id: 'g3', game_index: 3 },
  { id: 'g1', game_index: 1 },
  { id: 'g2', game_index: 2 },
];

test('the next game is the lowest game number that has not completed', () => {
  assert.equal(pickNextGame(games, { g1: 'completed' })?.id, 'g2');
});

test('a game with no state row yet counts as not started', () => {
  assert.equal(pickNextGame(games, {})?.id, 'g1');
});

test('there is no next game once every game has completed', () => {
  assert.equal(pickNextGame(games, { g1: 'completed', g2: 'completed', g3: 'completed' }), null);
});

test('an empty game list has no next game', () => {
  assert.equal(pickNextGame([], {}), null);
});
