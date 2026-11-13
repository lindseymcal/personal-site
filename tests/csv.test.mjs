import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvToObjects } from '../src/csv.mjs';

test('parses plain rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('quoted fields keep commas', () => {
  assert.deepEqual(parseCsv('a,"b,c",d\n'), [['a', 'b,c', 'd']]);
});

test('escaped quotes inside quoted fields', () => {
  assert.deepEqual(parseCsv('"she said ""hi""",x\n'), [['she said "hi"', 'x']]);
});

test('line breaks inside quotes stay in the field (LF and CRLF)', () => {
  assert.deepEqual(parseCsv('a,"line1\nline2"\n'), [['a', 'line1\nline2']]);
  assert.deepEqual(parseCsv('a,"x\r\ny"\r\nb,c\r\n'), [['a', 'x\r\ny'], ['b', 'c']]);
});

test('no trailing newline, and empty fields', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv('a,b\n,'), [['a', 'b'], ['', '']]);
});

test('CRLF line endings and a byte-order mark', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('Goodreads ISBN style survives parsing', () => {
  assert.deepEqual(parseCsv('x,"=""0123456789"""\n'), [['x', '="0123456789"']]);
});

test('csvToObjects uses the header and skips blank lines', () => {
  const objs = csvToObjects('Title,Author\nA,B\n\nC,D\n');
  assert.deepEqual(objs, [{ Title: 'A', Author: 'B' }, { Title: 'C', Author: 'D' }]);
});

test('csvToObjects fills missing trailing columns with empty strings', () => {
  assert.deepEqual(csvToObjects('a,b,c\n1,2\n'), [{ a: '1', b: '2', c: '' }]);
});

test('empty input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(csvToObjects(''), []);
});
