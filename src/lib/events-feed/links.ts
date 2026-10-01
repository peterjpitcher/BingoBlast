// src/lib/events-feed/links.ts
//
// Where an event's QR code points. Pure, so it is safe on the server and in
// tests.
//
// The QR prefers the event's own screen short link from the management app
// (`pre_event_screen` before the night, `in_game_screen` on a break during it,
// `post_event_screen` after it), which is tracked. Without one it falls back to the website's event-id link, which
// works but loses its tags to the website's canonical redirect (spec A6).
//
// Deliberately never the API's `url`, `offers.url` or `bookingUrl`: `url` and
// `offers.url` point at the management app itself, and `bookingUrl` is free
// text a manager types in.

import type { ScreenChannel } from './types';

/** The website's event page by id; the fallback when there is no short link. */
export function eventIdLink(id: string, channel: ScreenChannel): string {
  return `https://www.the-anchor.pub/events/${encodeURIComponent(id)}?utm_source=${channel}&utm_medium=screen`;
}

/**
 * True for an https link on the-anchor.pub or one of its subdomains (the
 * management app issues short links on l.the-anchor.pub). Anything else is
 * ignored, so a bad value in the management app can never put a QR code for
 * another site on the pub TV.
 */
export function isTrustedShortLink(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    parsed.protocol === 'https:' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    (host === 'the-anchor.pub' || host.endsWith('.the-anchor.pub')) &&
    parsed.pathname.length > 1
  );
}

/** An event's screen short links, by channel; null or absent when it has none. */
export type ScreenShortLinks = Partial<Record<ScreenChannel, string | null>>;

export interface EventLinkSource {
  id: string;
  /** From the event's detail lookup; null when that lookup failed. */
  shortLinks?: ScreenShortLinks | null;
}

/** The QR target for an event on the given screen channel. */
export function eventQr(event: EventLinkSource, channel: ScreenChannel): string {
  const shortLink = event.shortLinks?.[channel];
  if (typeof shortLink === 'string' && isTrustedShortLink(shortLink)) return shortLink;
  return eventIdLink(event.id, channel);
}
