// src/lib/playlist.ts
//
// What the pub TV loops through when no game is being called, and at the end
// of the night (Anchor Nights standard S7.4 and S7.5). The playlists come
// from the shared kit (@anchor-nights/kit/promo); this file only says which
// kit loop each phase of a bingo night uses, which of bingo's own slides lead
// it, and which event link (screen channel) the QR codes carry. Pure, so it
// is safe in the browser and in tests.
//
// The loops:
//   - before_start: the follow-along QR leads (bingo's own slide), then the
//     kit's idle loop: the next bingo night, the events two at a time with the
//     follow-along again between pairs, what's on once a loop, and bingo's
//     rules last. Links: pre_event_screen.
//   - a break in a game, and the gap between games: the same, led by the
//     Break time or Next game screen, with the rules last. Links:
//     in_game_screen.
//   - night_over: the kit's thank-you (Review us with Cash Bingo's own short
//     link, and What's on next or See what's on), then the next two events.
//     Links: post_event_screen.
//   - idle (/display with no session): the kit's idle loop with no lead, so
//     what's on leads ("Bingo nights at The Anchor"). Links: post_event_screen.
// With no events (none, an error, or no key), each falls back to its own
// short loop. The TV never shows an error about events.
import {
  buildIdlePlaylist,
  buildThankYouPlaylist,
  getUsableEvents,
  SLIDE_MS,
  type PromoSlideData,
} from '@anchor-nights/kit/promo';
import type { ScreenChannel, ScreenEvent, ScreenFeed } from '@anchor-nights/kit/events/shared';
import type { InGameSubState, NightPhase } from './night-phase';
import { REVIEW_URL } from './venue-links';

/** A phase of the night, or a TV on /display with no session to join. */
export type PlaylistPhase = NightPhase | 'idle';

/** Bingo's own slides, which the TV draws itself (the kit's `app` slides). */
export type BingoSlideId = 'follow_along' | 'rules' | 'break' | 'next_game';

/** The heading of the next-bingo-night slide, on the TV and the phones. */
export const NEXT_BINGO_LABEL = 'Next bingo night';

/** One slide of a playlist: the kit's slides plus bingo's own `app` slides. */
export type Slide = PromoSlideData;

/**
 * Which management short link an event's QR or "View event" link uses, for
 * the TV and the phones alike:
 *   - before the night starts: pre_event_screen;
 *   - on a break in a game, and between games: in_game_screen;
 *   - once the night is over, and on the idle screen: post_event_screen.
 * A game that is not on a break shows no events, and keeps post_event_screen.
 */
export function channelForPhase(phase: PlaylistPhase, inGameSubState: InGameSubState | null = null): ScreenChannel {
  if (phase === 'before_start') return 'pre_event_screen';
  if (phase === 'between_games' || (phase === 'in_game' && inGameSubState === 'break')) return 'in_game_screen';
  return 'post_event_screen';
}

/** An event's link for the phase (its short link for that channel, else its tagged page). */
export function eventLinkForPhase(
  event: ScreenEvent,
  phase: PlaylistPhase,
  inGameSubState: InGameSubState | null = null
): string {
  return event.links[channelForPhase(phase, inGameSubState)];
}

export interface PhoneEventItem {
  event: ScreenEvent;
  /** True for the next bingo night, which leads the list. */
  isNextBingo: boolean;
}

/**
 * The events a phone lists, next bingo night first: the same events as the
 * TV, dropped and chosen the same way (started events go, and tonight's own
 * bingo night is never "next").
 */
export function getPhoneEventList(feed: ScreenFeed | null, nowMs: number, sessionDate: string | null): PhoneEventItem[] {
  const usable = getUsableEvents(feed, nowMs, sessionDate);
  const items = usable.events.map((event) => ({ event, isNextBingo: false }));
  return usable.nextNight ? [{ event: usable.nextNight, isNextBingo: true }, ...items] : items;
}

/** The rules, once a loop, last: the loop then runs straight back to its lead. */
const RULES_SLIDE: Slide = { key: 'app-rules-0', kind: 'app', id: 'rules', durationMs: SLIDE_MS };

/** Each slide learns the next slide's image (wrapping round), for preloading. */
function withPreloads(slides: Slide[]): Slide[] {
  return slides.map((slide, index) => {
    const next = slides[(index + 1) % slides.length];
    const image = next && next !== slide && 'event' in next ? next.event.image : null;
    return { ...slide, preloadImage: image };
  });
}

/** A kit idle loop led by one of bingo's own slides, with the rules added last. */
function bingoLoop(
  lead: Exclude<BingoSlideId, 'rules'>,
  channel: ScreenChannel,
  feed: ScreenFeed | null,
  nowMs: number,
  sessionDate: string | null
): Slide[] {
  const slides = buildIdlePlaylist({ feed, nowMs, sessionDate, channel, lead: { id: lead } });
  return withPreloads([...slides, RULES_SLIDE]);
}

export interface BuildPlaylistOptions {
  /** For the in_game phase: only a break loops (the break screen, the events and the rules). */
  inGameSubState?: InGameSubState | null;
}

/**
 * The loop for a phase. An empty list means the screen shows its own fixed
 * layout (a game being called, a claim being checked, a win).
 *
 * `nowMs` (the screen's clock) and `sessionDate` (the London date of the
 * TV's session) decide which events are still to come and which bingo night
 * is the next one; the idle screen has no session, so passes null.
 */
export function buildPlaylist(
  phase: PlaylistPhase,
  feed: ScreenFeed | null,
  nowMs: number,
  sessionDate: string | null,
  opts: BuildPlaylistOptions = {}
): Slide[] {
  const channel = channelForPhase(phase, opts.inGameSubState ?? null);
  switch (phase) {
    case 'before_start':
      return bingoLoop('follow_along', channel, feed, nowMs, sessionDate);
    case 'between_games':
      return bingoLoop('next_game', channel, feed, nowMs, sessionDate);
    case 'in_game':
      return opts.inGameSubState === 'break' ? bingoLoop('break', channel, feed, nowMs, sessionDate) : [];
    case 'night_over':
      return buildThankYouPlaylist({ feed, nowMs, sessionDate, channel, reviewUrl: REVIEW_URL });
    case 'idle':
      return buildIdlePlaylist({ feed, nowMs, sessionDate, channel });
  }
}

/** True for one of bingo's own slides with this id. */
export function isBingoSlide(slide: Slide | null, id: BingoSlideId): boolean {
  return slide !== null && slide.kind === 'app' && slide.id === id;
}

/**
 * True for a slide that shows a QR code of its own: every kit slide (events,
 * the next bingo night, what's on, review, thank you) and bingo's
 * follow-along. The TV hides its corner follow-along QR while one of these is
 * up, so there is never more than one code on screen to scan.
 */
export function slideCarriesQr(slide: Slide): boolean {
  return slide.kind !== 'app' || slide.id === 'follow_along';
}

/**
 * Whether the TV's corner "Follow along on your phone" card stays up beside
 * this slide. Not beside a slide with a code of its own (slideCarriesQr), and
 * not beside the Break time card: that one stands alone in the middle of the
 * screen, so the kitchen message is what the room reads (the owner's call,
 * 1 October 2026). The card and its column go together, which is what centres
 * the slide.
 */
export function slideAllowsCornerQr(slide: Slide): boolean {
  return !isBingoSlide(slide, 'break') && !slideCarriesQr(slide);
}

/**
 * True for a slide that is about something other than the night itself: an
 * event, the next bingo night, or what's on. While one is up on a break or
 * between games, the TV's top bar says where the night is ("Break time",
 * "Next game coming up") in place of the game and book colour, so the slide
 * can give all its room to the artwork (the owner's call, 1 October 2026).
 */
export function slideShowsStatusInTopBar(slide: Slide): boolean {
  return slide.kind === 'event' || slide.kind === 'next_night' || slide.kind === 'whats_on';
}
