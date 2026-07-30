// src/lib/claim-request-id.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newClaimRequestId, uuidV4FromBytes } from './claim-request-id';
import { isUuid } from './utils';

// The whole point of the key is that one claim attempt gets one value and the
// next claim gets a different one. If these ever stopped holding, a tie would be
// silently swallowed as a duplicate, or a duplicate would be recorded as a tie.

test('newClaimRequestId returns something the server will accept as a uuid', () => {
  const id = newClaimRequestId();
  assert.ok(isUuid(id), `expected a uuid, got ${id}`);
});

test('two claims never share a key', () => {
  const keys = new Set(Array.from({ length: 1000 }, () => newClaimRequestId()));
  assert.equal(keys.size, 1000);
});

test('the getRandomValues fallback also produces a valid uuid', () => {
  // Byte 6 and byte 8 must be rewritten for version and variant, so all-zero and
  // all-ones inputs are the cases worth pinning.
  const zeros = uuidV4FromBytes(new Uint8Array(16));
  assert.ok(isUuid(zeros), zeros);
  assert.equal(zeros, '00000000-0000-4000-8000-000000000000');

  const ones = uuidV4FromBytes(new Uint8Array(16).fill(0xff));
  assert.ok(isUuid(ones), ones);
  assert.equal(ones, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('the fallback refuses the wrong number of bytes rather than emitting a short key', () => {
  assert.throws(() => uuidV4FromBytes(new Uint8Array(8)), /exactly 16 bytes/);
});

test('the fallback does not mutate the caller buffer', () => {
  const bytes = new Uint8Array(16);
  uuidV4FromBytes(bytes);
  assert.deepEqual(Array.from(bytes), new Array(16).fill(0));
});
