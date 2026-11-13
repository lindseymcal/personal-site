// Spine typography: titles and authors must always fit inside the spine and never cross the rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSpineTitle, wrapTitle, titleRoom, letterWidthFactor, spineStyle, authorLayout, SPINE_MIN_FONT, SPINE_MAX_FONT } from '../src/spine.mjs';
import { spineTitle, rowsToBooks } from '../src/books.mjs';
import { csvToObjects } from '../src/csv.mjs';
import { packNewestChronologically } from '../src/layout.mjs';
import { buildPages } from '../src/build-site.mjs';
import fs from 'node:fs';

const FACES = [['Cinzel', false], ['Playfair Display SC', false], ['IM Fell English SC', false], ['Libre Baskerville', false], ['Josefin Sans', true], ['Libre Baskerville', true]];
const TITLES = [
  'It', 'Emma', 'The Age of Innocence', "The Hitchhiker's Guide to the Galaxy",
  'The Curious Incident of the Dog in the Night-Time and Other Very Long Words',
  'A Very Long Title That Goes On And On And On Forever And Ever Amen And Then Some More',
  'Supercalifragilisticexpialidocious Pneumonoultramicroscopicsilicovolcanoconiosis',
  'Ａ', 'Ünïcödé Tïtle With Àccents', 'x'.repeat(200), 'The Life and Strange Surprizing Adventures of Robinson Crusoe of York, Mariner',
];

// the same estimate the code uses, rebuilt here as a check on what comes out
function fits(r, { width, height, family, caps, favorite, authorHeight }) {
  const factor = letterWidthFactor(family, caps);
  const room = titleRoom(height, favorite, authorHeight);
  const columnsUsed = r.lines.length * r.fontSize * 1.18;
  const longest = Math.max(...r.lines.map((l) => l.length)) * r.fontSize * factor;
  return longest <= room && columnsUsed <= width - 8 + 0.01 * width;
}

test('every extreme title, on every typeface, spine width and height, fits inside its spine', () => {
  for (const title of TITLES) for (const [family, caps] of FACES) for (const width of [26, 28, 32, 40, 52, 76, 96]) for (const height of [226, 262, 298]) for (const favorite of [false, true]) for (const authorHeight of [19, 45, 80]) {
    const o = { width, height, family, caps, favorite, authorHeight };
    const r = fitSpineTitle(title, o);
    assert.ok(r.lines.length >= 1, title);
    assert.ok(r.fontSize >= SPINE_MIN_FONT && r.fontSize <= SPINE_MAX_FONT, `${r.fontSize}`);
    assert.ok(fits(r, o), `${title.slice(0, 30)} | ${family} w${width} h${height} fav${favorite}: ${JSON.stringify(r)}`);
  }
});

test('a short title on a decent spine stays large and on one line', () => {
  const r = fitSpineTitle('Emma', { width: 44, height: 250, family: 'Playfair Display SC' });
  assert.equal(r.lines.length, 1);
  assert.ok(r.fontSize >= 17);
  assert.equal(r.truncated, false);
});

test('long titles wrap onto several lines (columns) before they shrink to the minimum', () => {
  const r = fitSpineTitle("The Hitchhiker's Guide to the Galaxy", { width: 52, height: 250, family: 'Libre Baskerville' });
  assert.ok(r.lines.length >= 2);
  assert.equal(r.lines.join(' '), "The Hitchhiker's Guide to the Galaxy"); // nothing lost
  assert.equal(r.truncated, false);
  assert.ok(r.fontSize > SPINE_MIN_FONT);
});

test('as a last resort the title is cut with an ellipsis, at the smallest size', () => {
  const r = fitSpineTitle('x'.repeat(200), { width: 30, height: 230, family: 'Cinzel' });
  assert.equal(r.truncated, true);
  assert.equal(r.fontSize, SPINE_MIN_FONT);
  assert.ok(r.lines.at(-1).endsWith('…'));
  assert.ok(r.lines.every((l) => l.length < 60));
});

test('a thin spine never gets text wider than it is', () => {
  const r = fitSpineTitle('Walden', { width: 28, height: 230, family: 'Josefin Sans', caps: true });
  assert.ok(r.fontSize <= 28 * 0.45 + 0.01);
  assert.equal(r.lines.length, 1);
});

test('a favorite has less room (the star) than a plain book', () => {
  assert.ok(titleRoom(250, true) < titleRoom(250, false));
  const o = { width: 44, height: 240, family: 'Libre Baskerville' };
  assert.ok(fitSpineTitle('A Fairly Long Title Indeed Here', { ...o, favorite: true }).fontSize <= fitSpineTitle('A Fairly Long Title Indeed Here', o).fontSize);
});

test('wrapTitle: greedy, splits over-long words, never returns an empty line', () => {
  assert.deepEqual(wrapTitle('aa bb cc dd', 5), ['aa bb', 'cc dd']);
  assert.deepEqual(wrapTitle('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapTitle('  ', 5), []);
  assert.ok(wrapTitle('a b  c   d', 3).every((l) => l.length > 0));
});

test('subtitles after a colon or semicolon are dropped on the spine only; the full title stays in labels', () => {
  assert.equal(spineTitle('Thinking, Fast and Slow: A Subtitle (Series)'), 'Thinking, Fast and Slow');
  assert.equal(spineTitle("Moby-Dick; or, The Whale"), 'Moby-Dick');
  const csv = 'Book Id,Title,Author,Exclusive Shelf,Date Read,Number of Pages\n1,"Long Subtitle Book: A Subtitle That Is Very Long Indeed",A B,read,2026/01/01,300\n';
  const html = buildPages({ csvText: csv }).pages['books.html'];
  assert.ok(html.includes('aria-label="Long Subtitle Book: A Subtitle That Is Very Long Indeed, A B"'));
  assert.ok(html.includes('title="Long Subtitle Book: A Subtitle That Is Very Long Indeed, A B"'));
  assert.ok(!html.includes('<span>A Subtitle'));
});

test('markup: title lines are separate columns, the author sits under its own rule, nothing overlaps', () => {
  const html = buildPages({ csvText: fs.readFileSync(new URL('./fixtures/sample-goodreads.csv', import.meta.url), 'utf8') }).pages['books.html'];
  assert.match(html, /<span class="t"><span>[^<]+<\/span>(<span>[^<]+<\/span>)*<\/span><span class="a">/);
  const css = fs.readFileSync(new URL('../assets/books.css', import.meta.url), 'utf8');
  assert.match(css, /\.spine \.a\{[^}]*border-top:2px solid var\(--band/); // the rule belongs to the author block
  assert.match(css, /\.spine \.t\{[^}]*overflow:hidden/);
  assert.ok(!/calc\(100% - 40px\)/.test(css), 'the old free-floating rule must be gone');
});

test('extreme fixture books build into spines with fitted lines', () => {
  const header = 'Book Id,Title,Author,Author l-f,Exclusive Shelf,Date Read,Number of Pages,Original Publication Year\n';
  const rows = [
    ['1', 'It', 'Stephen King', 'King, Stephen', 30, 1986],
    ['2', 'The Life and Strange Surprizing Adventures of Robinson Crusoe of York, Mariner', 'Daniel Defoe', 'Defoe, Daniel', 400, 1719],
    ['3', 'x'.repeat(150), 'A Person With An Extremely Long Name Indeed', 'Vanderhoeven-Longsurnamington, A Person With An Extremely Long Name Indeed', 90, 2001],
    ['4', 'Short', 'Mc', 'Mc, X', 5, 2010],
  ].map(([id, t, a, lf, p, y]) => `${id},"${t}","${a}","${lf}",read,2026/01/0${id},${p},${y}`).join('\n');
  const books = rowsToBooks(csvToObjects(header + rows));
  assert.equal(books.length, 4);
  for (const b of books) {
    const st = spineStyle(b, undefined);
    assert.ok(st.lines.length >= 1 && st.fontSize >= SPINE_MIN_FONT);
  }
  const html = buildPages({ csvText: header + rows }).pages['books.html'];
  assert.ok(html.includes('<span class="a v" style="--ah:80px"><span>Vanderhoeven-Longsurnamington</span></span>')); // runs up the spine, clipped with an ellipsis if still too long ...
  assert.ok(html.includes('A Person With An Extremely Long Name Indeed, a favorite') || html.includes('A Person With An Extremely Long Name Indeed"')); // ... the full name stays in the label
});

test('shelf order: books on a year shelf run oldest to newest, left to right', () => {
  const header = 'Book Id,Title,Author,Exclusive Shelf,Date Read\n';
  const csv = header + [['1', 'March', '2026/03/01'], ['2', 'January', '2026/01/01'], ['3', 'May', '2026/05/01']].map(([i, t, d]) => `${i},${t},A B,read,${d}`).join('\n');
  const html = buildPages({ csvText: csv }).pages['books.html'];
  const order = [...html.matchAll(/<a class="spine[^"]*" id="s-\d+"[^>]*aria-label="(\w+),/g)].map((m) => m[1]);
  assert.deepEqual(order, ['January', 'March', 'May']);
});

test('home shelf packing: newest books, laid out oldest to newest; nothing is lost when re-packing', () => {
  // costs newest first
  const tiers = packNewestChronologically([30, 30, 30, 30, 30, 30], [60, 60]);
  assert.deepEqual(tiers, [[3, 2], [1, 0]]); // the four newest (0..3), oldest of them first
  assert.deepEqual(packNewestChronologically([], [50]), [[]]);
  // mixed widths where a chronological re-pack would not fit: still a valid, in-order layout
  const t2 = packNewestChronologically([50, 10, 50, 10, 50], [60, 60]);
  const flat = t2.flat();
  assert.deepEqual([...flat].sort((a, b) => b - a), flat); // oldest (high index) to newest, never out of order
  for (const tier of t2) assert.ok(tier.reduce((s, i) => s + [50, 10, 50, 10, 50][i], 0) <= 60);
});

test('the site name comes from site.config.json and shows everywhere the name appears', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../site.config.json', import.meta.url), 'utf8'));
  assert.equal(cfg.name, 'Lindsey');
  const { pages } = buildPages({ csvText: fs.readFileSync(new URL('./fixtures/sample-goodreads.csv', import.meta.url), 'utf8'), configRaw: cfg, projectsRaw: [{ title: 'P' }] });
  assert.ok(pages['index.html'].includes('<title>Lindsey</title>'));
  assert.equal((pages['index.html'].match(/<h1 class="sign">Lindsey<\/h1>/g) || []).length, 2); // study and phone wall
  for (const [name, html] of Object.entries(pages)) assert.ok(!html.includes('Your Name'), name);
  assert.ok(pages['books.html'].includes('<title>Books, Lindsey</title>'));
  assert.ok(pages['writing.html'].includes('<title>Writing, Lindsey</title>'));
});

test('an author that does not fit across a thin spine runs up the spine, and the title gives up room for it', () => {
  assert.deepEqual(authorLayout('Roy', 40), { vertical: false, height: 19 });
  const long = authorLayout('Dostoevsky', 30);
  assert.equal(long.vertical, true);
  assert.ok(long.height > 19 && long.height <= 80);
  assert.equal(authorLayout('x'.repeat(100), 30).height, 80);
  assert.ok(titleRoom(250, false, long.height) < titleRoom(250, false));
  const st = spineStyle({ title: 'T', spineTitle: 'A Long Title For A Thin Spine', spineAuthor: 'Dostoevsky', pages: 30, pubYear: 1866, color: '', favorite: false }, undefined);
  assert.equal(st.authorVertical, true);
  assert.ok(st.lines.length >= 1);
});
