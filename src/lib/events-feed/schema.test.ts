// src/lib/events-feed/schema.test.ts
//
// Parsing the management API. A bad event must be dropped alone, never the
// whole list, and a bad optional field must not cost an event its place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventsFeedError } from './errors';
import {
  BINGO_CATEGORY,
  ALL_CATEGORIES,
  MUSIC_BINGO_OCT_16,
  PARTY_OCT_31,
  QUIZ_OCT_7,
  categoriesResponse,
  detailResponse,
  listResponse,
} from './fixtures';
import { pickEventImage } from './projection';
import { findCategoryId, parseEventList, parseManagementEvent, parseScreenShortLinks } from './schema';

const BUCKET = 'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/events';

test('a live-shaped list parses to the fields the screens use', () => {
  const { events, dropped } = parseEventList(listResponse([QUIZ_OCT_7, MUSIC_BINGO_OCT_16]));
  assert.equal(dropped, 0);
  assert.deepEqual(events[0], {
    id: '76ec328b-48f8-47c0-b041-cc405e085deb',
    title: 'A Hint of Halloween Quiz Night',
    startsAt: '2026-10-07T18:00:00.000Z',
    status: 'scheduled',
    category: 'quiz-night-stanwell-moor',
    images: {
      landscape: `${BUCKET}/76ec328b-48f8-47c0-b041-cc405e085deb/landscape/branded/1788709830381-landscape.png`,
      square: `${BUCKET}/76ec328b-48f8-47c0-b041-cc405e085deb/square/branded/1788709820568-square.png`,
      hero: `${BUCKET}/76ec328b-48f8-47c0-b041-cc405e085deb/square/branded/1788709820568-square.png`,
    },
    imageAlt: 'Quiz Night teams taking part in a pub quiz at The Anchor in Stanwell Moor',
  });
  assert.equal(events[1].category, 'music-bingo');
});

test('one malformed event is dropped alone and counted', () => {
  const malformed = [
    { ...QUIZ_OCT_7, id: 'not-a-uuid' },
    { ...QUIZ_OCT_7, name: '   ' },
    { ...QUIZ_OCT_7, startDate: '2026-10-07T19:00:00' }, // no zone: ambiguous, so rejected
    { ...QUIZ_OCT_7, startDate: 'next Tuesday' },
    null,
    'an event',
  ];
  for (const bad of malformed) {
    const { events, dropped } = parseEventList(listResponse([bad, MUSIC_BINGO_OCT_16, PARTY_OCT_31]));
    assert.equal(dropped, 1, JSON.stringify(bad));
    assert.deepEqual(events.map((e) => e.title), [
      'Screams & Soundtracks: Classic Horror Music Bingo',
      'Enter If You Dare: The House of Horrors Halloween Party',
    ]);
  }
});

test('a wrong envelope fails the whole list, so the last good projection keeps serving', () => {
  for (const bad of [
    { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many' } },
    { success: true, data: { events: 'none' } },
    { success: true },
    [],
    null,
  ]) {
    assert.throws(
      () => parseEventList(bad),
      (err: unknown) => err instanceof EventsFeedError && err.code === 'parse',
      JSON.stringify(bad),
    );
  }
});

test('an offset start is normalised to one UTC form', () => {
  const event = parseManagementEvent({ ...QUIZ_OCT_7, startDate: '2026-10-07T19:00:00+01:00' });
  assert.equal(event?.startsAt, '2026-10-07T18:00:00.000Z');
});

test('missing images give null, and the event still shows as a text-only card', () => {
  const event = parseManagementEvent({
    ...QUIZ_OCT_7,
    landscapeImageUrl: undefined,
    squareImageUrl: null,
    heroImageUrl: '',
    image_alt_text: undefined,
  });
  assert.ok(event);
  assert.deepEqual(event.images, { landscape: null, square: null, hero: null });
  assert.equal(pickEventImage(event), null);
});

test('a bad optional field becomes null instead of dropping the event', () => {
  const event = parseManagementEvent({
    ...QUIZ_OCT_7,
    landscapeImageUrl: 42,
    image_alt_text: { text: 'no' },
    category: 'quiz',
    event_status: false,
  });
  assert.ok(event);
  assert.equal(event.images.landscape, null);
  assert.equal(event.imageAlt, null);
  assert.equal(event.category, null);
  assert.equal(event.status, null);
});

test('images prefer landscape, then square, then hero, and only from the event-images bucket', () => {
  const base = parseManagementEvent(QUIZ_OCT_7);
  assert.ok(base);
  assert.deepEqual(pickEventImage(base), {
    url: base.images.landscape,
    alt: 'Quiz Night teams taking part in a pub quiz at The Anchor in Stanwell Moor',
    square: false,
  });

  const square = { ...base, images: { ...base.images, landscape: null } };
  assert.equal(pickEventImage(square)?.url, base.images.square);
  assert.equal(pickEventImage(square)?.square, true, 'square art is flagged so it is shown whole');

  const heroOnly = { ...base, images: { landscape: null, square: null, hero: `${BUCKET}/x/hero.png` } };
  assert.equal(pickEventImage(heroOnly)?.url, `${BUCKET}/x/hero.png`);
  assert.equal(pickEventImage(heroOnly)?.square, true, 'the hero image is the square artwork');

  const offBucket = {
    ...base,
    images: {
      landscape: 'https://example.com/landscape.png',
      square: 'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/other-bucket/square.png',
      hero: `${BUCKET}/x/hero.png?width=500`,
    },
  };
  assert.equal(pickEventImage(offBucket), null);

  const noAlt = { ...base, imageAlt: null };
  assert.equal(pickEventImage(noAlt)?.alt, 'A Hint of Halloween Quiz Night', 'alt falls back to the title');
});

test('the bingo-night category id is found by slug', () => {
  assert.equal(findCategoryId(categoriesResponse(ALL_CATEGORIES), 'bingo-night'), BINGO_CATEGORY.id);
  assert.equal(findCategoryId(categoriesResponse(ALL_CATEGORIES.filter((c) => c.slug !== 'bingo-night')), 'bingo-night'), null);
  assert.equal(
    findCategoryId({ success: true, data: { categories: [null, { id: 7 }, BINGO_CATEGORY] } }, 'bingo-night'),
    BINGO_CATEGORY.id,
    'a malformed category is skipped alone',
  );
  assert.throws(() => findCategoryId({ success: false }, 'bingo-night'), EventsFeedError);
});

test('screen short links are read from qr_short_links, then marketing_short_links', () => {
  const id = QUIZ_OCT_7.id as string;
  assert.deepEqual(
    parseScreenShortLinks(
      detailResponse(id, {
        pre_event_screen: 'https://l.the-anchor.pub/ps1a2b',
        in_game_screen: 'https://l.the-anchor.pub/sc5e6f',
        post_event_screen: 'https://l.the-anchor.pub/ns3c4d',
        beer_mat: 'https://l.the-anchor.pub/bm',
      }),
    ),
    {
      pre_event_screen: 'https://l.the-anchor.pub/ps1a2b',
      in_game_screen: 'https://l.the-anchor.pub/sc5e6f',
      post_event_screen: 'https://l.the-anchor.pub/ns3c4d',
    },
  );

  const marketingOnly = {
    success: true,
    data: {
      id,
      marketing_short_links: {
        in_game_screen: 'https://l.the-anchor.pub/sc5e6f',
        post_event_screen: 'https://l.the-anchor.pub/ns3c4d',
      },
    },
  };
  assert.deepEqual(parseScreenShortLinks(marketingOnly), {
    pre_event_screen: null,
    in_game_screen: 'https://l.the-anchor.pub/sc5e6f',
    post_event_screen: 'https://l.the-anchor.pub/ns3c4d',
  });

  const none = { pre_event_screen: null, in_game_screen: null, post_event_screen: null };
  assert.deepEqual(parseScreenShortLinks(detailResponse(id)), none);

  const untrusted = {
    success: true,
    data: {
      qr_short_links: { pre_event_screen: 'https://evil.example/x', in_game_screen: 'http://l.the-anchor.pub/sc5e6f' },
      marketing_short_links: 'oops',
    },
  };
  assert.deepEqual(parseScreenShortLinks(untrusted), none);

  assert.throws(() => parseScreenShortLinks({ success: false, error: { code: 'NOT_FOUND' } }), EventsFeedError);
});
