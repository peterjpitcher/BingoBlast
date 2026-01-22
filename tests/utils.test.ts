import test from 'node:test';
import assert from 'node:assert/strict';

import { getContrastColor } from '../src/lib/utils';

test('getContrastColor selects readable text classes', () => {
  assert.equal(getContrastColor('#ffffff'), 'text-slate-900');
  assert.equal(getContrastColor('#000000'), 'text-white');
  assert.equal(getContrastColor('#ff0000'), 'text-white');
  assert.equal(getContrastColor(''), 'text-white');
});
