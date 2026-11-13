// Tester's extra tests: CSV and Goodreads data edge cases, and privacy of unneeded columns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvToObjects } from '../src/csv.mjs';
import { rowToBook, rowsToBooks, cleanIsbn, pickIsbn, parseRating, parseGoodreadsDate, bookWhen } from '../src/books.mjs';
import { buildPages } from '../src/build-site.mjs';

const HEADER = 'Book Id,Title,Author,Author l-f,ISBN,ISBN13,My Rating,Number of Pages,Original Publication Year,Year Published,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Private Notes,Read Count,Owned Copies';
const line = (o) => {
  const d = { id: '1', title: 'T', author: 'A B', lf: 'B, A', isbn: '', isbn13: '', rating: '0', pages: '100', opy: '1900', yp: '1900', read: '2024/03/05', added: '2024/01/01', shelves: 'read', pos: 'read (#1)', shelf: 'read', review: '', notes: '', rc: '1', oc: '0', ...o };
  const q = (v) => `"${String(v).replaceAll('"', '""')}"`;
  return [d.id, q(d.title), q(d.author), q(d.lf), d.isbn, d.isbn13, d.rating, d.pages, d.opy, d.yp, d.read, d.added, q(d.shelves), q(d.pos), d.shelf, q(d.review), q(d.notes), d.rc, d.oc].join(',');
};
const csv = (...rows) => [HEADER, ...rows].join('\n') + '\n';

test('csv: CRLF, BOM, trailing newline or none all give the same rows', () => {
  const base = 'a,b\n1,2\n3,4';
  const want = [['a', 'b'], ['1', '2'], ['3', '4']];
  assert.deepEqual(parseCsv(base), want);
  assert.deepEqual(parseCsv(base + '\n'), want);
  assert.deepEqual(parseCsv(base.replaceAll('\n', '\r\n')), want);
  assert.deepEqual(parseCsv(base.replaceAll('\n', '\r\n') + '\r\n'), want);
  assert.deepEqual(parseCsv('﻿' + base), want);
});

test('csv: quoted newlines (LF and CRLF), commas and escaped quotes survive', () => {
  const rows = parseCsv('a,b\r\n"line1\r\nline2","say ""hi"", ok"\r\n');
  assert.deepEqual(rows[1], ['line1\r\nline2', 'say "hi", ok']);
  assert.deepEqual(parseCsv('a\n"x""""y"\n')[1], ['x""y']);
});

test('csv: empty trailing field, empty quoted field at EOF, empty input', () => {
  assert.deepEqual(parseCsv('a,b,\n1,2,'), [['a', 'b', ''], ['1', '2', '']]);
  assert.deepEqual(parseCsv('a,b\n1,""'), [['a', 'b'], ['1', '']]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(csvToObjects(''), []);
  assert.deepEqual(csvToObjects('Book Id,Title\n'), []);
});

test('csv: unterminated quote does not hang or throw', () => {
  const rows = parseCsv('a,b\n1,"never closed\nstill going');
  assert.equal(rows.length, 2);
});

test('csv: ragged rows (short and long) and blank lines', () => {
  const objs = csvToObjects('a,b,c\n1,2\n\n4,5,6,7\n');
  assert.deepEqual(objs, [{ a: '1', b: '2', c: '' }, { a: '4', b: '5', c: '6' }]);
});

test('csv: header whitespace is trimmed', () => {
  assert.deepEqual(csvToObjects(' Book Id , Title \n1,x\n'), [{ 'Book Id': '1', Title: 'x' }]);
});

test('missing columns: a CSV with only some columns still yields books without throwing', () => {
  const books = rowsToBooks(csvToObjects('Book Id,Title,Exclusive Shelf\n5,Only Three,read\n'));
  assert.equal(books.length, 1);
  assert.equal(books[0].isbn, '');
  assert.equal(books[0].rating, 0);
  assert.equal(books[0].year, 0);
  assert.equal(books[0].when, '');
});

test('missing Exclusive Shelf column means zero books (nothing leaks in by accident)', () => {
  assert.deepEqual(rowsToBooks(csvToObjects('Book Id,Title\n5,Hello\n')), []);
});

test('Goodreads ISBNs: ="..." wrapper, empty ISBN13, X check digit, junk', () => {
  assert.equal(cleanIsbn('="0141439688"'), '0141439688');
  assert.equal(cleanIsbn('="080442957X"'), '080442957X');
  assert.equal(cleanIsbn('="080442957x"'), '080442957X');
  assert.equal(cleanIsbn('=""'), '');
  assert.equal(cleanIsbn(''), '');
  assert.equal(cleanIsbn('123'), '');
  assert.equal(cleanIsbn('978-0-14-143954-9'), '9780141439549');
  assert.equal(pickIsbn('=""', '="0141439688"'), '0141439688');
  assert.equal(pickIsbn('="9780141439686"', '="0141439688"'), '9780141439686');
  assert.equal(pickIsbn(undefined, undefined), '');
});

test('ratings: 0 and junk mean unrated, out of range is clamped', () => {
  assert.equal(parseRating('0'), 0);
  assert.equal(parseRating(''), 0);
  assert.equal(parseRating('abc'), 0);
  assert.equal(parseRating('9'), 5);
  assert.equal(parseRating('-3'), 0);
  assert.equal(parseRating('4.5'), 4);
});

test('a rating of 0 draws no dots in the page; a real rating does', () => {
  const page = (rating) => buildPages({ csvText: csv(line({ rating })) }).pages['books.html'];
  assert.ok(!page('0').includes('class="dots"'));
  assert.ok(page('3').includes('aria-label="3 out of 5"'));
});

test('dates: slash and dash formats, bad month/day, empty', () => {
  assert.deepEqual(parseGoodreadsDate('2024/03/05'), { year: 2024, month: 3, day: 5 });
  assert.deepEqual(parseGoodreadsDate('2024-03-05'), { year: 2024, month: 3, day: 5 });
  assert.deepEqual(parseGoodreadsDate('2024/03'), { year: 2024, month: 3, day: 1 });
  assert.equal(parseGoodreadsDate('2024/13/05'), null);
  assert.equal(parseGoodreadsDate('2024/00/05'), null);
  assert.equal(parseGoodreadsDate('2024/03/40'), null);
  assert.equal(parseGoodreadsDate(''), null);
  assert.equal(parseGoodreadsDate('March 5, 2024'), null);
});

test('missing Date Read falls back to Date Added and says "shelved"; neither gives Undated', () => {
  assert.equal(bookWhen('', '2023/02/01').label, 'shelved Feb 2023');
  assert.equal(bookWhen('', '2023/02/01').year, 2023);
  assert.equal(bookWhen('2024/03/05', '2023/02/01').label, 'read Mar 2024');
  const html = buildPages({ csvText: csv(line({ read: '', added: '' })) }).pages['books.html'];
  assert.ok(html.includes('Read in Undated'));
});

test('only the "read" shelf is used; other shelves and look-alikes are excluded', () => {
  for (const shelf of ['to-read', 'currently-reading', 'dnf', 'Read', 'read-ish', '']) {
    assert.equal(rowToBook({ 'Book Id': '1', Title: 'x', 'Exclusive Shelf': shelf }), null, shelf);
  }
  // Bookshelves column says "read" but the exclusive shelf does not: excluded
  assert.equal(rowToBook({ 'Book Id': '1', Title: 'x', Bookshelves: 'read', 'Exclusive Shelf': 'to-read' }), null);
  assert.ok(rowToBook({ 'Book Id': '1', Title: 'x', 'Exclusive Shelf': ' read ' }));
});

test('rows with no Book Id or no title are dropped', () => {
  assert.equal(rowToBook({ 'Book Id': '', Title: 'x', 'Exclusive Shelf': 'read' }), null);
  assert.equal(rowToBook({ 'Book Id': '1', Title: '  ', 'Exclusive Shelf': 'read' }), null);
});

test('PRIVACY: the book object only holds the whitelisted fields', () => {
  const b = rowToBook({ 'Book Id': '1', Title: 'x', 'Exclusive Shelf': 'read', 'Private Notes': 'SECRET', 'Owned Copies': '3', 'Read Count': '9', Bookshelves: 'SHELFSECRET', 'Bookshelves with positions': 'POSSECRET (#4)', 'Average Rating': '3.99', Publisher: 'PUBSECRET' });
  assert.deepEqual(Object.keys(b).sort(), ['author', 'color', 'favorite', 'id', 'isbn', 'pages', 'pubYear', 'rating', 'recommendedBy', 'review', 'sortKey', 'spineAuthor', 'spineTitle', 'title', 'when', 'year']);
  assert.ok(!JSON.stringify(b).match(/SECRET|PUBSECRET/));
});

test('PRIVACY: unneeded columns never reach any generated page', () => {
  const text = csv(line({ notes: 'NOTESECRET-1', shelves: 'SHELFSECRET-2', pos: 'POSSECRET-3 (#9)', rc: '777', oc: '888' }));
  const { pages } = buildPages({ csvText: text, projectsRaw: [{ title: 'P' }] });
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!/SECRET/.test(html), name);
  }
  assert.ok(!pages['books.html'].includes('777') && !pages['books.html'].includes('888'));
});

test('PRIVACY: a Private Notes cell containing a quoted newline and comma stays out', () => {
  const text = csv(line({ notes: 'line one, "secret"\nline two PRIV' }));
  for (const html of Object.values(buildPages({ csvText: text }).pages)) assert.ok(!html.includes('PRIV'));
});

test('duplicate Book Ids in one export do not crash the build', () => {
  const { pages } = buildPages({ csvText: csv(line({ id: '7', title: 'One' }), line({ id: '7', title: 'Two' })) });
  assert.ok(pages['books.html'].includes('One') && pages['books.html'].includes('Two'));
});

test('multi-byte, emoji and accented titles pass through intact', () => {
  const { pages } = buildPages({ csvText: csv(line({ title: 'Les Misérables 📚 日本語' })) });
  assert.ok(pages['books.html'].includes('Les Misérables 📚 日本語'));
});
