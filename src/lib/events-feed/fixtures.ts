// src/lib/events-feed/fixtures.ts
//
// Test fixtures shaped like the management API's real responses. The events
// are taken from the public events feed on 1 October 2026 (the website proxies
// the same objects), trimmed to the fields the feed reads plus the link fields
// it must ignore. Used only by the *.test.ts files in this folder.

const BUCKET = 'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/events';

type RawEvent = Record<string, unknown>;

function liveEvent(
  id: string,
  slug: string,
  name: string,
  startDate: string,
  category: { id: string; name: string; slug: string },
  alt: string,
): RawEvent {
  return {
    id,
    slug,
    name,
    startDate,
    date: startDate.slice(0, 10),
    time: '19:00',
    event_status: 'scheduled',
    category,
    landscapeImageUrl: `${BUCKET}/${id}/landscape/branded/1788709830381-landscape.png`,
    squareImageUrl: `${BUCKET}/${id}/square/branded/1788709820568-square.png`,
    heroImageUrl: `${BUCKET}/${id}/square/branded/1788709820568-square.png`,
    image_alt_text: alt,
    // The feed must never use these three for a QR code.
    url: `https://management.orangejelly.co.uk/events/${slug}`,
    bookingUrl: null,
    offers: { '@type': 'Offer', url: `https://management.orangejelly.co.uk/events/${slug}` },
  };
}

const QUIZ = { id: '65bf6647-3d76-4bb8-a719-572acbb6fb5a', name: 'Quiz Night', slug: 'quiz-night-stanwell-moor' };
const MUSIC_BINGO = { id: '8493fffe-b218-484c-8646-4e28cfd6c2f8', name: 'Music Bingo', slug: 'music-bingo' };
const PARTIES = { id: 'a3e13e87-816b-48cb-ba8f-ef6f9ae68b36', name: 'Parties', slug: 'parties' };
export const BINGO_CATEGORY = { id: '715cc457-a90c-48e8-a774-da13addf19ed', name: 'Cash Bingo', slug: 'bingo-night' };

export const QUIZ_OCT_7 = liveEvent(
  '76ec328b-48f8-47c0-b041-cc405e085deb',
  'quiz-night-2026-10-07',
  'A Hint of Halloween Quiz Night',
  '2026-10-07T18:00:00.000Z',
  QUIZ,
  'Quiz Night teams taking part in a pub quiz at The Anchor in Stanwell Moor',
);

export const MUSIC_BINGO_OCT_16 = liveEvent(
  'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac',
  'screams-and-soundtracks-classic-horror-music-bingo-2026-10-16',
  'Screams & Soundtracks: Classic Horror Music Bingo',
  '2026-10-16T18:00:00.000Z',
  MUSIC_BINGO,
  'Music Bingo cards and music-themed game at The Anchor pub in Stanwell Moor',
);

export const PARTY_OCT_31 = liveEvent(
  'd52cbd18-d293-4516-beca-e151eaa90180',
  'halloween-party-2026-10-31',
  'Enter If You Dare: The House of Horrors Halloween Party',
  '2026-10-31T20:00:00.000Z',
  PARTIES,
  'People enjoying the Halloween Party at The Anchor in costumes and fancy dress.',
);

export const BINGO_NOV_18 = liveEvent(
  '6e761f65-8b17-4bc9-8a01-d032b77f6a66',
  'snowball-showdown-cash-bingo-2026-11-18',
  'Snowball Showdown Cash Bingo',
  '2026-11-18T19:00:00.000Z',
  BINGO_CATEGORY,
  'Cash Bingo cards and players at The Anchor pub in Stanwell Moor',
);

export const BINGO_DEC_16 = liveEvent(
  'b9334958-76b4-4504-a64a-0d47145bd75e',
  'christmas-jackpot-cash-bingo-2026-12-16',
  'Christmas Jackpot Cash Bingo',
  '2026-12-16T19:00:00.000Z',
  BINGO_CATEGORY,
  'Cash Bingo cards and players at The Anchor pub in Stanwell Moor',
);

/** GET /events: { success, data: { events, meta } }. */
export function listResponse(events: unknown[]): unknown {
  return {
    success: true,
    data: {
      events,
      meta: { total: events.length, limit: 50, offset: 0, has_more: false, lastUpdated: '2026-10-01T08:00:00.000Z' },
    },
  };
}

/** GET /event-categories: { success, data: { categories, meta } }. */
export function categoriesResponse(categories: Array<{ id: string; name: string; slug: string }>): unknown {
  return {
    success: true,
    data: { categories, meta: { total: categories.length, lastUpdated: '2026-10-01T08:00:00.000Z' } },
  };
}

export const ALL_CATEGORIES = [QUIZ, MUSIC_BINGO, PARTIES, BINGO_CATEGORY];

/**
 * GET /events/{id}, with the link maps keyed by channel (for the screens:
 * pre_event_screen, in_game_screen and post_event_screen).
 */
export function detailResponse(id: string, links: Record<string, string> = {}): unknown {
  return {
    success: true,
    data: {
      id,
      qr_short_links: links,
      marketing_short_links: { facebook: 'https://l.the-anchor.pub/fb1234', ...links },
      bookingUrl: null,
      url: 'https://management.orangejelly.co.uk/events/some-event',
    },
  };
}
