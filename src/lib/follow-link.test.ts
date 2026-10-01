// src/lib/follow-link.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowUrl, stripScheme } from './follow-link';

const ID = '5f0c2b7e-6a55-4a8e-9a57-2f1d7b1a9c3e';

test('the unique session gets the short /play link', () => {
  assert.equal(
    buildFollowUrl({ origin: 'https://bingo-blast-ten.vercel.app', sessionId: ID, isUniqueSession: true }),
    'https://bingo-blast-ten.vercel.app/play'
  );
});

test('any other session carries its id, so the QR leads to the session its TV shows', () => {
  assert.equal(
    buildFollowUrl({ origin: 'https://bingo-blast-ten.vercel.app', sessionId: ID, isUniqueSession: false }),
    `https://bingo-blast-ten.vercel.app/play?s=${ID}`
  );
});

test('a trailing slash on the origin is not doubled', () => {
  assert.equal(
    buildFollowUrl({ origin: 'https://bingo-blast-ten.vercel.app/', sessionId: ID, isUniqueSession: true }),
    'https://bingo-blast-ten.vercel.app/play'
  );
});

test('the short link stays short enough for a small, easily scanned code', () => {
  // About 37 characters on the production domain: a 29x29 code at level M.
  const url = buildFollowUrl({ origin: 'https://bingo-blast-ten.vercel.app', sessionId: ID, isUniqueSession: true });
  assert.ok(url.length <= 40, `${url} is ${url.length} characters`);
});

test('the printed address drops the scheme', () => {
  assert.equal(stripScheme('https://bingo-blast-ten.vercel.app/play'), 'bingo-blast-ten.vercel.app/play');
  assert.equal(stripScheme('http://localhost:3000/play?s=1'), 'localhost:3000/play?s=1');
});
