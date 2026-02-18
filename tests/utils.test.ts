import test from 'node:test';
import assert from 'node:assert/strict';

import { getContrastColor, isUuid } from '../src/lib/utils';

test('getContrastColor selects readable text classes', () => {
  assert.equal(getContrastColor('#ffffff'), 'text-slate-900');
  assert.equal(getContrastColor('#000000'), 'text-white');
  assert.equal(getContrastColor('#ff0000'), 'text-white');
  assert.equal(getContrastColor(''), 'text-white');
});

test('isUuid validates UUID formatted route params', () => {
  assert.equal(isUuid('3c3d5afe-2bbc-4a34-a7e1-33f0fceadd82'), true);
  assert.equal(isUuid('not-a-real-session'), false);
  assert.equal(isUuid('12345678-1234-1234-1234-123456789abz'), false);
});
