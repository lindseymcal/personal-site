import test from 'node:test';
import assert from 'node:assert/strict';
import { packIntoRows, packIntoTiers } from '../src/layout.mjs';

test('packIntoRows starts a new row when the next item does not fit', () => {
  assert.deepEqual(packIntoRows([40, 40, 40, 40, 40], 100), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(packIntoRows([], 100), []);
});

test('packIntoRows never loses a book wider than the shelf', () => {
  assert.deepEqual(packIntoRows([150, 20], 100), [[0], [1]]);
});

test('packIntoTiers fills shelves in order and stops when full', () => {
  assert.deepEqual(packIntoTiers([30, 30, 30, 30, 30, 30], [60, 60]), [[0, 1], [2, 3]]);
  assert.deepEqual(packIntoTiers([30], [60, 60]), [[0], []]);
});

test('packIntoTiers moves a book that does not fit down a shelf, and leaves out what fits nowhere', () => {
  assert.deepEqual(packIntoTiers([50, 50, 5], [60, 60]), [[0], [1, 2]]);
  assert.deepEqual(packIntoTiers([50, 50, 20], [60, 60]), [[0], [1]]); // the 20 fits on neither shelf any more
});

test('packIntoTiers skips a shelf too narrow for the book', () => {
  assert.deepEqual(packIntoTiers([30, 30], [20, 100]), [[], [0, 1]]);
});
