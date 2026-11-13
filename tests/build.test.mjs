import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPages } from '../src/build-site.mjs';
import { planShelf, bookDomId } from '../src/render.mjs';
import { groupByYear, rowsToBooks } from '../src/books.mjs';
import { csvToObjects } from '../src/csv.mjs';
import { spineStyle } from '../src/spine.mjs';
import { normalizeEntry } from '../src/feed.mjs';

const csvText = fs.readFileSync(new URL('./fixtures/sample-goodreads.csv', import.meta.url), 'utf8');
const extras = {
  9000001: { favorite: true, recommendedBy: 'Ada', showReview: true },
  9000008: { showReview: true },
  9000002: { favorite: true },
  9000099: { favorite: true },
};
const colors = { 9780141439549: '#123456' }; // Middlemarch
const essay = (t, d, over = {}) => normalizeEntry({ title: t, url: `https://lindseymcal.substack.com/p/${encodeURIComponent(t)}`, date: d, ...over });
const projectsRaw = [{ title: 'Agent fleet' }, { title: 'Painting app' }];

const build = (over = {}) => buildPages({ csvText, extras, colors, configRaw: { name: 'Zee <b>' }, projectsRaw, essays: [essay('First', '2026-10-30')], ...over });
const section = (html, id) => html.match(new RegExp(`<section class="pull" id="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';

test('produces every page', () => {
  const { pages } = build();
  assert.deepEqual(Object.keys(pages).sort(), ['books.html', 'index.html', 'projects.html', 'projects/agent-fleet.html', 'projects/painting-app.html', 'writing.html']);
});

test('Private Notes text never reaches any page', () => {
  for (const html of Object.values(build().pages)) assert.ok(!html.includes('PRIVATE-NOTE'));
});

test('text from the CSV and config is escaped, never raw HTML', () => {
  const { pages } = build();
  assert.ok(!pages['books.html'].includes('alert("x")'));
  assert.ok(pages['books.html'].includes('alert(&quot;x&quot;)'));
  assert.ok(!pages['index.html'].includes('Zee <b>'));
  assert.ok(pages['index.html'].includes('Zee &lt;b&gt;'));
  // the only <script> tags on the books page are the page's own tiny fit script
  assert.equal((pages['books.html'].match(/<script/g) || []).length, 1);
});

test('only the read shelf is on the shelf', () => {
  const html = build().pages['books.html'];
  assert.ok(!html.includes('The Scarlet Letter'));
  assert.ok(!html.includes('Pride and Prejudice'));
  assert.ok(html.includes('Persuasion'));
});

test('favorites: gold star on the spine and the card, and screen readers hear it', () => {
  const html = build().pages['books.html'];
  assert.match(html, /aria-label="Persuasion, Jane Austen, a favorite"[^>]*>(<i class="foil" aria-hidden="true"><\/i>)/);
  assert.ok(section(html, 'b-9000001').includes('role="img" aria-label="A favorite"'));
  assert.ok(!/aria-label="Walden, Henry David Thoreau, a favorite"/.test(html));
  assert.ok(!section(html, 'b-9000003').includes('foil'));
});

test('recommended-by slip shows only when set', () => {
  const html = build().pages['books.html'];
  assert.ok(section(html, 'b-9000001').includes('recommended by Ada'));
  assert.ok(!section(html, 'b-9000002').includes('recommended by'));
});

test('rating 0 shows no dots at all; other ratings show five with an accessible label', () => {
  const html = build().pages['books.html'];
  assert.ok(!section(html, 'b-9000006').includes('dots'));
  assert.ok(section(html, 'b-9000001').includes('aria-label="4 out of 5"'));
  assert.equal((section(html, 'b-9000001').match(/<i( class="o")?><\/i>/g) || []).length, 5);
});

test('review shows as a letter; no review shows the small library card', () => {
  const html = build().pages['books.html'];
  assert.ok(section(html, 'b-9000001').includes('class="letter"'));
  assert.ok(section(html, 'b-9000001').includes('<p>The letter near the end is the best part.</p>'));
  assert.ok(section(html, 'b-9000003').includes('class="card"'));
  assert.ok(!section(html, 'b-9000003').includes('class="letter"'));
});

test('date style: read, or shelved when there is no read date', () => {
  const html = build().pages['books.html'];
  assert.ok(section(html, 'b-9000001').includes('read Oct 2026'));
  assert.ok(section(html, 'b-9000005').includes('shelved Mar 2026'));
});

test('shelves are grouped by year with a brass plate each', () => {
  const html = build().pages['books.html'];
  assert.ok(html.includes('<span class="plate" aria-hidden="true">2026</span>'));
  assert.ok(html.includes('<span class="plate" aria-hidden="true">2025</span>'));
  assert.ok(html.indexOf('>2026</span>') < html.indexOf('>2025</span>'));
});

test('the cached cover color is used for the spine; the extras color override wins', () => {
  let html = build().pages['books.html'];
  assert.match(html, /id="s-9000002"[^>]*--c:#123456/);
  html = build({ extras: { 9000002: { color: '#AA0000' } } }).pages['books.html'];
  assert.match(html, /id="s-9000002"[^>]*--c:#aa0000/);
});

test('every spine opens its own book, and every book can be put back', () => {
  const html = build().pages['books.html'];
  const spines = html.match(/<a class="spine[^"]*" id="s-(\d+)" href="#b-\1"/g) || [];
  const pulls = html.match(/<section class="pull" id="b-\d+"/g) || [];
  assert.equal(spines.length, pulls.length);
  assert.ok(spines.length > 20);
  assert.equal((html.match(/class="scrim" href="#s-\d+"/g) || []).length, pulls.length); // putting a book back returns focus to its spine
  assert.ok(html.includes('id="shelf"'));
});

test('home shelf: the newest reads, shown oldest to newest left to right; same colors as the books page', () => {
  const html = build().pages['index.html'];
  const room = html.slice(html.indexOf('fit-room'), html.indexOf('wall-fit'));
  const colors = [...room.matchAll(/<i class="sp hs[^"]*" style="--w:\d+px;--h:\d+px;--c:(#[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.ok(colors.length > 8);
  assert.equal(colors.at(-1), '#123456'); // Middlemarch is the most recent read: last, at the right of the bottom shelf
  assert.notEqual(colors[0], '#123456');
});

test('the study has exactly one route into each section and no menu', () => {
  const html = build().pages['index.html'];
  assert.ok(!html.includes('<nav'));
  // each link appears once for the desktop room and once for the phone wall
  for (const href of ['books.html', 'writing.html', 'projects.html', 'https://art.example.com', 'https://www.instagram.com/your-handle', 'resume.pdf', 'https://www.linkedin.com/in/your-name']) {
    assert.equal(html.split(`href="${href}"`).length - 1, 2, href);
  }
  assert.ok(!html.includes('substack'));
});

test('only the name is visible text in the study; every object has an aria-label', () => {
  const html = build().pages['index.html'];
  const room = html.slice(html.indexOf('class="fit fit-room"'), html.indexOf('class="wall-fit"'));
  const anchors = room.match(/<a class="obj[^>]*>/g);
  assert.equal(anchors.length, 7);
  for (const a of anchors) assert.match(a, /aria-label="[^"]+"/);
  assert.ok(room.includes('<h1 class="sign">Zee &lt;b&gt;</h1>'));
});

test('way home: first focusable thing on every inner page, named for screen readers', () => {
  const { pages } = build();
  for (const name of ['books.html', 'writing.html', 'projects.html', 'projects/agent-fleet.html']) {
    const body = pages[name].slice(pages[name].indexOf('<body'));
    const firstLink = body.match(/<a [^>]*>/)[0];
    assert.match(firstLink, /class="home"/, name);
    assert.match(firstLink, /aria-label="Back to the study"/, name);
  }
});

test('project pages: second small object goes back to Projects; no résumé link', () => {
  const html = build().pages['projects/agent-fleet.html'];
  assert.ok(html.includes('class="tinlink" href="../projects.html" aria-label="All projects"'));
  assert.ok(!/resume/i.test(html));
  assert.ok(html.includes('href="../index.html"'));
});

test('writing page lists essays and keeps Substack as a quiet envelope', () => {
  const html = build().pages['writing.html'];
  assert.ok(html.includes('<a href="https://lindseymcal.substack.com/p/First">First</a>')); // links to the post, same tab
  assert.ok(html.includes('class="env" href="https://your-name.substack.com/subscribe"'));
});

test('every scene page has the fit script; reduced motion rules exist in the css', () => {
  const { pages } = build();
  for (const name of ['index.html', 'books.html', 'writing.html', 'projects.html']) assert.ok(pages[name].includes("classList.add('fitted')"), name);
  const css = ['home', 'books', 'writing', 'projects'].map((f) => fs.readFileSync(new URL(`../assets/${f}.css`, import.meta.url), 'utf8'));
  for (const c of css) assert.ok(c.includes('prefers-reduced-motion: no-preference'));
  // no animation or transition on hover outside the media query: crude check that keyframes live inside it
  const home = css[0];
  assert.ok(home.indexOf('@keyframes') > home.indexOf('prefers-reduced-motion: no-preference'));
});

test('a big library makes a taller shelf that scrolls, not a broken one', () => {
  const header = csvText.split('\n')[0];
  const row = (i) => `${100 + i},Book ${i},Author ${i},"Author, ${i}",,,,3,4,,,${200 + (i % 50) * 10},2000,2000,2026/01/${String(1 + (i % 28)).padStart(2, '0')},2026/01/01,read,read (#1),read,,,,1,0`;
  const big = [header, ...Array.from({ length: 120 }, (_, i) => row(i))].join('\n');
  const html = buildPages({ csvText: big, projectsRaw }).pages['books.html'];
  const rows = Number(html.match(/--rows:(\d+)/)[1]);
  assert.ok(rows > 2);
  const stageH = Number(html.match(/data-stage-h="(\d+)"/)[1]);
  assert.equal(stageH, 34 + rows * 348 + 44 + 26);
  assert.match(html, /<html lang="en" class="scene p-books tall"/);
});

test('an empty library still builds', () => {
  const { pages } = buildPages({ csvText: csvText.split('\n')[0] + '\n', projectsRaw });
  assert.ok(pages['books.html'].includes('class="case"'));
  assert.ok(pages['index.html'].includes('class="shelf"') || pages['index.html'].includes('obj shelf'));
});

test('planShelf starts a new row for each year and never mixes years', () => {
  const books = rowsToBooks(csvToObjects(csvText));
  const rows = planShelf(groupByYear(books), (b) => spineStyle(b, undefined));
  assert.ok(rows.length >= 2);
  const labels = rows.filter((r) => r.first).map((r) => r.label);
  assert.deepEqual(labels, ['2026', '2025']);
  assert.equal(rows.reduce((n, r) => n + r.items.length, 0), books.length);
});

test('unmatched books-extra ids produce a warning', () => {
  assert.ok(build().warnings.some((w) => w.includes('9000099')));
});

test('bookDomId keeps ids safe for HTML and CSS', () => {
  assert.equal(bookDomId('123'), '123');
  assert.equal(bookDomId('a"b c<d>'), 'abcd');
  assert.equal(bookDomId('!!!'), 'x');
});

test('warns when the CSV is missing key columns (wrong file)', () => {
  const w = buildPages({ csvText: 'Name,Email\na,b\n', projectsRaw }).warnings.join('\n');
  assert.match(w, /Exclusive Shelf/);
  assert.match(w, /Book Id/);
  assert.equal(build().warnings.some((x) => x.includes('column')), false);
});

test('a malformed cached color falls back to the title color with a warning', () => {
  const r = build({ colors: { 9780141439549: 'not-a-color', 9780141439686: ['#112233'] } });
  assert.ok(r.warnings.some((x) => x.includes('9780141439549')));
  assert.match(r.pages['books.html'], /id="s-9000002"[^>]*--c:#[0-9a-f]{6}/);
});

test('a post whose address is not on Substack never gets a link', () => {
  assert.equal(essay('T', '2026-10-30', { url: 'https://evil.example.com/p/x' }), null);
  assert.equal(essay('T', '2026-10-30', { url: 'javascript:alert(1)' }), null);
  assert.ok(essay('T', '2026-10-30', { url: 'https://other.substack.com/p/x' }));
});
