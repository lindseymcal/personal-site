import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  escapeHtml, decodeBasicEntities, reviewToParagraphs, reviewToHtml, cleanIsbn, pickIsbn, parseRating, parsePages,
  parseGoodreadsDate, formatMonthYear, bookWhen, stripSeries, spineTitle, spineAuthor, rowToBook, rowsToBooks,
  mergeExtra, unmatchedExtraIds, groupByYear, selectHomeShelf, byRecent, slugify,
} from '../src/books.mjs';
import { csvToObjects } from '../src/csv.mjs';

const fixture = fs.readFileSync(new URL('./fixtures/sample-goodreads.csv', import.meta.url), 'utf8');

test('escapeHtml escapes the five dangerous characters', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});

test('decodeBasicEntities turns entities back into characters', () => {
  assert.equal(decodeBasicEntities('Fish &amp; chips &#39;n&#39; &quot;x&quot; &lt;3'), `Fish & chips 'n' "x" <3`);
  assert.equal(decodeBasicEntities('&#0;'), '&#0;'); // not a printable character: left alone
});

test('reviews: <br/> makes paragraphs, in every spelling', () => {
  assert.deepEqual(reviewToParagraphs('one<br/><br/>two<br>three<BR />four'), ['one', 'two', 'three', 'four']);
  assert.deepEqual(reviewToParagraphs('line one\nline two\r\n\r\nline three'), ['line one', 'line two', 'line three']);
});

test('reviews: tags are removed and the text is escaped, never passed through as HTML', () => {
  const html = reviewToHtml('hello <script>alert("x")</script> <i>there</i><br/>a < b & c > d');
  assert.equal(html, '<p>hello alert(&quot;x&quot;) there</p>\n<p>a &lt; b &amp; c &gt; d</p>');
  assert.ok(!html.includes('<script'));
});

test('reviews: decoded entities are escaped again', () => {
  assert.equal(reviewToHtml('&lt;script&gt;x&lt;/script&gt;'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(reviewToHtml('Fish &amp; chips'), '<p>Fish &amp; chips</p>');
});

test('empty review gives no paragraphs', () => {
  assert.equal(reviewToHtml(''), '');
  assert.equal(reviewToHtml('  <br/> \n '), '');
});

test('cleanIsbn handles the Goodreads ="..." format', () => {
  assert.equal(cleanIsbn('="0123456789"'), '0123456789');
  assert.equal(cleanIsbn('="9780141439686"'), '9780141439686');
  assert.equal(cleanIsbn('978-0-14-143968-6'), '9780141439686');
  assert.equal(cleanIsbn('="080442957x"'), '080442957X');
  assert.equal(cleanIsbn('=""'), '');
  assert.equal(cleanIsbn('12345'), '');
  assert.equal(cleanIsbn(undefined), '');
});

test('pickIsbn prefers ISBN13', () => {
  assert.equal(pickIsbn('="9780141439686"', '="0141439688"'), '9780141439686');
  assert.equal(pickIsbn('=""', '="0141439688"'), '0141439688');
  assert.equal(pickIsbn('=""', '=""'), '');
});

test('parseRating: 0 is unrated, clamps to 0..5', () => {
  assert.equal(parseRating('4'), 4);
  assert.equal(parseRating('0'), 0);
  assert.equal(parseRating(''), 0);
  assert.equal(parseRating('9'), 5);
  assert.equal(parseRating('-1'), 0);
});

test('parsePages', () => {
  assert.equal(parsePages('352'), 352);
  assert.equal(parsePages(''), 0);
  assert.equal(parsePages('1,017'), 1017);
});

test('Goodreads dates', () => {
  assert.deepEqual(parseGoodreadsDate('2026/10/14'), { year: 2026, month: 10, day: 14 });
  assert.deepEqual(parseGoodreadsDate('2026-03-05'), { year: 2026, month: 3, day: 5 });
  assert.deepEqual(parseGoodreadsDate('2026/03'), { year: 2026, month: 3, day: 1 });
  assert.equal(parseGoodreadsDate(''), null);
  assert.equal(parseGoodreadsDate('2026/13/01'), null);
  assert.equal(parseGoodreadsDate('yesterday'), null);
  assert.equal(formatMonthYear({ year: 2026, month: 10, day: 1 }), 'Oct 2026');
});

test('bookWhen: read date first, then shelved date, then nothing', () => {
  assert.deepEqual(bookWhen('2026/10/14', '2026/01/01'), { label: 'read Oct 2026', year: 2026, sortKey: '2026-10-14' });
  assert.deepEqual(bookWhen('', '2026/03/05'), { label: 'shelved Mar 2026', year: 2026, sortKey: '2026-03-05' });
  assert.deepEqual(bookWhen('', ''), { label: '', year: 0, sortKey: '0000-00-00' });
});

test('titles for spines', () => {
  assert.equal(stripSeries('Cranford (Penguin Classics)'), 'Cranford');
  assert.equal(stripSeries('Dune (Dune, #1)'), 'Dune');
  assert.equal(stripSeries('Plain'), 'Plain');
  assert.equal(spineTitle('Moby-Dick; or, The Whale (Penguin Classics)'), 'Moby-Dick');
  assert.equal(spineTitle('Walden: Or, Life in the Woods'), 'Walden');
  assert.equal(spineTitle('It'), 'It');
});

test('spine author is the last name', () => {
  assert.equal(spineAuthor('Austen, Jane', 'Jane Austen'), 'Austen');
  assert.equal(spineAuthor('', 'Jane Austen'), 'Austen');
  assert.equal(spineAuthor('Du Bois, W. E. B.', 'W. E. B. Du Bois'), 'Du Bois');
});

test('slugify', () => {
  assert.equal(slugify('Agent Fleet!'), 'agent-fleet');
  assert.equal(slugify('Ántonia'), 'antonia');
  assert.equal(slugify('???'), 'book');
});

test('rowToBook keeps only the read shelf', () => {
  const rows = csvToObjects(fixture);
  const shelves = new Set(rows.map((r) => r['Exclusive Shelf']));
  assert.ok(shelves.has('to-read') && shelves.has('currently-reading') && shelves.has('read'));
  const books = rowsToBooks(rows);
  assert.equal(books.length, rows.filter((r) => r['Exclusive Shelf'] === 'read').length);
  assert.ok(!books.some((b) => b.title === 'Pride and Prejudice'));
});

test('rowToBook never carries Private Notes or other unneeded columns', () => {
  const books = rowsToBooks(csvToObjects(fixture));
  assert.ok(!JSON.stringify(books).includes('PRIVATE-NOTE'));
  const keys = Object.keys(books[0]).sort();
  assert.deepEqual(keys, ['author', 'color', 'favorite', 'id', 'isbn', 'pages', 'pubYear', 'rating', 'recommendedBy', 'review', 'sortKey', 'spineAuthor', 'spineTitle', 'title', 'when', 'year']);
});

test('rowToBook maps a real-looking row', () => {
  const b = rowsToBooks(csvToObjects(fixture)).find((x) => x.title === 'Persuasion');
  assert.equal(b.id, '9000001');
  assert.equal(b.isbn, '9780141439686');
  assert.equal(b.rating, 4);
  assert.equal(b.pages, 249);
  assert.equal(b.pubYear, 1817);
  assert.equal(b.when, 'read Oct 2026');
  assert.equal(b.spineAuthor, 'Austen');
});

test('unrated and undated rows from the sample', () => {
  const books = rowsToBooks(csvToObjects(fixture));
  assert.equal(books.find((b) => b.title === 'North and South').rating, 0);
  const moby = books.find((b) => b.id === '9000005');
  assert.equal(moby.when, 'shelved Mar 2026');
  assert.equal(moby.title, 'Moby-Dick; or, The Whale');
});

test('rowToBook rejects rows with no id or title', () => {
  assert.equal(rowToBook({ 'Exclusive Shelf': 'read', Title: 'x' }), null);
  assert.equal(rowToBook({ 'Exclusive Shelf': 'read', 'Book Id': '1' }), null);
});

const mk = (id, title, sortKey, extra = {}) => ({
  id, title, sortKey, year: Number(sortKey.slice(0, 4)), favorite: false, recommendedBy: '', color: '', ...extra,
});

test('mergeExtra: favorite, recommendedBy and a valid color', () => {
  const b = mk('1', 'A', '2026-01-01');
  const m = mergeExtra(b, { 1: { favorite: true, recommendedBy: ' Ada ', color: '#8C5A78' } });
  assert.equal(m.favorite, true);
  assert.equal(m.recommendedBy, 'Ada');
  assert.equal(m.color, '#8c5a78');
});

test('mergeExtra ignores bad colors, non-boolean favorites, and unknown ids', () => {
  const b = mk('1', 'A', '2026-01-01');
  assert.equal(mergeExtra(b, { 1: { color: 'red' } }).color, '');
  assert.equal(mergeExtra(b, { 1: { favorite: 'yes' } }).favorite, false);
  assert.equal(mergeExtra(b, { 2: { favorite: true } }), b);
  assert.equal(mergeExtra(b, undefined), b);
  assert.equal(mergeExtra(b, { __proto__: { 1: { favorite: true } } }).favorite, false);
});

test('unmatchedExtraIds finds typos but skips _notes', () => {
  assert.deepEqual(unmatchedExtraIds([mk('1', 'A', '2026-01-01')], { _readme: 'x', 1: {}, 99: {} }), ['99']);
});

test('groupByYear: newest year first, newest book first, undated last', () => {
  const groups = groupByYear([
    mk('1', 'Old', '2024-05-01'),
    mk('2', 'New', '2026-05-01'),
    mk('3', 'Newer', '2026-09-01'),
    mk('4', 'Nodate', '0000-00-00', { year: 0 }),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['2026', '2024', 'Undated']);
  assert.deepEqual(groups[0].books.map((b) => b.title), ['Newer', 'New']);
});

test('byRecent breaks ties by title so the order is stable', () => {
  const a = mk('1', 'Apple', '2026-01-01'), b = mk('2', 'Banana', '2026-01-01');
  assert.ok(byRecent(a, b) < 0);
});

test('selectHomeShelf: recency only (newest first), favorites get no special place, up to capacity', () => {
  const books = [
    mk('1', 'plain-new', '2026-10-01'),
    mk('2', 'fav-old', '2025-01-01', { favorite: true }),
    mk('3', 'plain-old', '2025-06-01'),
    mk('4', 'fav-new', '2026-02-01', { favorite: true }),
  ];
  assert.deepEqual(selectHomeShelf(books, 10).map((b) => b.title), ['plain-new', 'fav-new', 'plain-old', 'fav-old']);
  assert.deepEqual(selectHomeShelf(books, 2).map((b) => b.title), ['plain-new', 'fav-new']);
  assert.deepEqual(selectHomeShelf(books, 0), []);
  assert.equal(books[0].title, 'plain-new'); // the input is not reordered
  // a book with only a date added (sortKey from Date Added) ranks by that date
  assert.equal(selectHomeShelf([mk('5', 'shelved', '2026-12-01'), mk('6', 'read', '2026-11-01')], 1)[0].title, 'shelved');
});
