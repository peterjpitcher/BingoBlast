// src/lib/events-feed/links.test.ts
//
// Where an event's QR code points: the management app's screen short link
// when there is one, otherwise the website's id link with the channel tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventIdLink, eventQr, isTrustedShortLink } from './links';

const ID = '76ec328b-48f8-47c0-b041-cc405e085deb';

test('the screen short link for the channel is preferred', () => {
  const event = {
    id: ID,
    shortLinks: { pre_event_screen: 'https://l.the-anchor.pub/ps1a2b', post_event_screen: 'https://l.the-anchor.pub/ns3c4d' },
  };
  assert.equal(eventQr(event, 'pre_event_screen'), 'https://l.the-anchor.pub/ps1a2b');
  assert.equal(eventQr(event, 'post_event_screen'), 'https://l.the-anchor.pub/ns3c4d');
});

test('without a short link for the channel, the id link is used, exactly', () => {
  const event = { id: ID, shortLinks: { pre_event_screen: 'https://l.the-anchor.pub/ps1a2b', post_event_screen: null } };
  assert.equal(
    eventQr(event, 'post_event_screen'),
    'https://www.the-anchor.pub/events/76ec328b-48f8-47c0-b041-cc405e085deb?utm_source=post_event_screen&utm_medium=screen',
  );
  assert.equal(
    eventQr({ id: ID, shortLinks: null }, 'pre_event_screen'),
    'https://www.the-anchor.pub/events/76ec328b-48f8-47c0-b041-cc405e085deb?utm_source=pre_event_screen&utm_medium=screen',
  );
  assert.equal(eventQr({ id: ID }, 'pre_event_screen'), eventIdLink(ID, 'pre_event_screen'));
});

test('a short link that is not an https the-anchor.pub link is ignored', () => {
  for (const bad of [
    'http://l.the-anchor.pub/ps1a2b',
    'https://evil.example/ps1a2b',
    'https://the-anchor.pub.evil.example/ps1a2b',
    'https://l.the-anchor.pub:8443/ps1a2b',
    'https://user:pass@l.the-anchor.pub/ps1a2b',
    'https://l.the-anchor.pub/',
    'javascript:alert(1)',
    'not a url',
  ]) {
    assert.equal(isTrustedShortLink(bad), false, bad);
    assert.equal(
      eventQr({ id: ID, shortLinks: { pre_event_screen: bad } }, 'pre_event_screen'),
      eventIdLink(ID, 'pre_event_screen'),
      bad,
    );
  }
  assert.equal(isTrustedShortLink('https://the-anchor.pub/x'), true);
  assert.equal(isTrustedShortLink('https://L.The-Anchor.pub/ps1a2b'), true);
});

test('the id is escaped in the id link', () => {
  assert.equal(
    eventIdLink('a/b?c', 'pre_event_screen'),
    'https://www.the-anchor.pub/events/a%2Fb%3Fc?utm_source=pre_event_screen&utm_medium=screen',
  );
});
