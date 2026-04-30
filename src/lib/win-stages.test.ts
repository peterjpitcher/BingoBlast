// src/lib/win-stages.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRequiredSelectionCountForStage, REQUIRED_SELECTION_COUNT_BY_STAGE } from './win-stages';

test('Line returns 5', () => assert.equal(getRequiredSelectionCountForStage('Line'), 5));
test('Two Lines returns 10', () => assert.equal(getRequiredSelectionCountForStage('Two Lines'), 10));
test('Full House returns 15', () => assert.equal(getRequiredSelectionCountForStage('Full House'), 15));
test('unknown stage returns null', () => {
  assert.equal(getRequiredSelectionCountForStage('Bogus'), null);
});
test('map is exhaustive over WinStage', () => {
  // Compile-time check: extending WinStage without adding to the map will fail tsc.
  assert.equal(Object.keys(REQUIRED_SELECTION_COUNT_BY_STAGE).length, 3);
});
