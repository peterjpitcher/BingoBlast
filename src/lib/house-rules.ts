// src/lib/house-rules.ts
//
// The bingo house rules, the "how to win" lines and the game identity line,
// shown on:
//   - the pub TV (the before_start rules slide, the break and between_games);
//   - the phone (inline before the first game, and behind the Rules button all
//     night);
//   - the host's first-game briefing.
//
// The rules are the owner-approved wording of spec 5.3 (decision D2), word for
// word. Rule 8, the snowball, is built from the live pot values, so it can only
// be shown when a pot is known.
import type { WinStage } from '@/types/database';
import { formatPoundsAmount } from './money';
import { getColourName } from './colour-name';

/** Rules 1 to 7. Rule 8 comes from buildSnowballRule(). */
export const HOUSE_RULES: ReadonlyArray<string> = [
  'Over 18s only.',
  'Pay for your books before the game starts. Maximum stake £5 per person per game.',
  'Play the book colour shown on the screen.',
  'Shout as soon as you win. Your claim must include the last number called; once the next number is called, it is too late.',
  'Winners on the same number share the prize.',
  'If a claim is wrong, the game carries on.',
  "The caller's decision is final.",
];

/** The pot fields rule 8 needs (a `snowball_pots` row satisfies this). */
export interface SnowballRulePot {
  current_max_calls: number;
  current_jackpot_amount: number;
  calls_increment: number;
  jackpot_increment: number;
}

function calls(count: number): string {
  return `${count} ${count === 1 ? 'call' : 'calls'}`;
}

/**
 * Rule 8: "Snowball: a Full House within 58 calls wins £180. If nobody wins it,
 * it grows by £20 and 2 calls. You must have played the last three games to
 * qualify." Null when any pot value is unusable, so a screen never shows "NaN
 * calls" or a £0 jackpot it cannot vouch for.
 */
export function buildSnowballRule(pot: SnowballRulePot): string | null {
  const maxCalls = Number(pot.current_max_calls);
  const jackpot = Number(pot.current_jackpot_amount);
  const jackpotIncrement = Number(pot.jackpot_increment);
  const callsIncrement = Number(pot.calls_increment);
  const usable =
    Number.isInteger(maxCalls) && maxCalls > 0 &&
    Number.isFinite(jackpot) && jackpot > 0 &&
    Number.isFinite(jackpotIncrement) && jackpotIncrement >= 0 &&
    Number.isInteger(callsIncrement) && callsIncrement >= 0;
  if (!usable) return null;

  return (
    `Snowball: a Full House within ${calls(maxCalls)} wins ${formatPoundsAmount(jackpot)}. ` +
    `If nobody wins it, it grows by ${formatPoundsAmount(jackpotIncrement)} and ${calls(callsIncrement)}. ` +
    'You must have played the last three games to qualify.'
  );
}

/** Rules 1 to 7, plus rule 8 when a usable snowball pot is known. */
export function getHouseRules(pot: SnowballRulePot | null | undefined): string[] {
  const snowball = pot ? buildSnowballRule(pot) : null;
  return snowball ? [...HOUSE_RULES, snowball] : [...HOUSE_RULES];
}

export interface HowToWinLine {
  stage: WinStage;
  text: string;
}

/** How to win each stage, spec 5.3. Shown as "Line: one full row on a ticket." */
export const HOW_TO_WIN: ReadonlyArray<HowToWinLine> = [
  { stage: 'Line', text: 'one full row on a ticket.' },
  { stage: 'Two Lines', text: 'two full rows on the same ticket.' },
  { stage: 'Full House', text: 'all 15 numbers on one ticket.' },
];

/** "Line: one full row on a ticket." */
export function formatHowToWin(line: HowToWinLine): string {
  return `${line.stage}: ${line.text}`;
}

/** Shown on the phone with the rules (spec 5.3). */
export const PHONE_FOLLOW_ONLY_NOTE = 'This follows the paper game. You cannot enter or claim here.';

export interface GameIdentityInput {
  /** The game's number in the night, from 1. */
  number: number | null | undefined;
  /** How many games the night has, when known. */
  total: number | null | undefined;
  /** The game's background colour, a '#rrggbb' hex. */
  colourHex: string | null | undefined;
}

/**
 * "Game 3 of 10 · Blue book", from the game's colour through getColourName (the
 * colour word matters to colour-blind players and hosts). Parts that are not
 * known are left out rather than shown as "Unknown colour" or "of 0".
 */
export function formatGameIdentity({ number, total, colourHex }: GameIdentityInput): string {
  const hasNumber = typeof number === 'number' && Number.isInteger(number) && number > 0;
  const hasTotal = hasNumber && typeof total === 'number' && Number.isInteger(total) && total >= (number as number);
  const colourName = colourHex ? getColourName(colourHex) : 'Unknown colour';
  const colour = colourName === 'Unknown colour' ? null : `${colourName} book`;

  const game = hasNumber ? (hasTotal ? `Game ${number} of ${total}` : `Game ${number}`) : null;
  return [game, colour].filter(Boolean).join(' · ');
}

/**
 * A game's number and the night's total, from the session's games in
 * game_index order. The number is the game's position, so a gap left by a
 * deleted game never reads "Game 11 of 10".
 */
export function getGamePosition(
  games: ReadonlyArray<{ id: string; game_index: number }>,
  gameId: string | null | undefined
): { number: number; total: number } | null {
  if (!gameId) return null;
  const ordered = [...games].sort((a, b) => a.game_index - b.game_index);
  const index = ordered.findIndex((game) => game.id === gameId);
  return index === -1 ? null : { number: index + 1, total: ordered.length };
}

export type CallResponse = { number: number; response: string };

/**
 * Call-and-response prompts. Shown on the host pre-game briefing and on the
 * public display's rules slide. Numeric order for scanability.
 */
export const CALL_RESPONSES: ReadonlyArray<CallResponse> = [
  { number: 2, response: 'a quack' },
  { number: 11, response: 'a wolf whistle' },
  { number: 22, response: 'a double quack' },
  { number: 59, response: 'tap your pen on your glass' },
  { number: 69, response: 'an ooooooooo' },
  { number: 88, response: 'wobble wobble' },
];
