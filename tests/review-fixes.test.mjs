// Tests for the review round: CLI needs a CSV path, cache lives outside the repo, spoilers and the
// reviews setting, one scroll box per notebook page, cover download checks, essay footer, tab order.
// SAFETY: every CLI run passes an explicit fixture/temp CSV path or none at all (which must refuse
// before reading anything), with HOME pointed at a temp folder.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { applyReviewPolicy, rowToBook, isTruthyFlag } from '../src/books.mjs';
import { normalizeConfig, applyEssayFooter, parseEssay } from '../src/site.mjs';
import { fetchCoverColor, sipsAvailable } from '../src/cover.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests/fixtures/sample-goodreads.csv');
const csvText = fs.readFileSync(FIXTURE, 'utf8');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tempDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')); made.push(d); return d; }
function makeCopy() {
  const dir = tempDir();
  for (const item of ['scripts', 'src', 'content', 'writing', 'site.config.json', 'package.json', 'assets']) fs.cpSync(path.join(REPO, item), path.join(dir, item), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir, ...env } });
const essay = (t, d) => parseEssay(`<meta name="essay-title" content="${t}"><meta name="essay-date" content="${d}">`, `${t}.html`);
const section = (html, id) => html.match(new RegExp(`<section class="pull" id="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';

test('the build refuses to run with no CSV path, says why, and writes nothing', () => {
  const dir = makeCopy();
  const r = run(dir, []);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Tell me which CSV/);
  assert.match(r.stderr, /npm run build:sample/);
  assert.ok(!fs.existsSync(path.join(dir, 'index.html')));
  assert.ok(!fs.existsSync(path.join(dir, '.agent-fleet')));
});

test('package.json: build:sample uses the fixture, and neither script is a bare no-argument build', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts;
  assert.match(scripts['build:sample'], /tests\/fixtures\/sample-goodreads\.csv/);
  assert.match(scripts['build:sample'], /--cache tests\/fixtures\/sample-spine-colors\.json/);
  assert.match(scripts.build, /goodreads_library_export\.csv/);
});

test('the color cache lives outside the repo, and is pruned to the books in this build', () => {
  const dir = makeCopy();
  const cache = path.join(dir, '.agent-fleet/goodreads/spine-colors.json');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({ 9780141439686: '#123456', 1111111111111: '#abcdef' }));
  const r = run(dir, [FIXTURE, '--offline']);
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.deepEqual(after, { 9780141439686: '#123456' }); // the removed book's ISBN is forgotten
  assert.ok(!fs.existsSync(path.join(dir, 'content/spine-colors.json')));
  assert.ok(!fs.existsSync(path.join(REPO, 'content/spine-colors.json')), 'the repo must not carry a cache of ISBNs');
});

test('--cache points the build at another cache file (the sample build uses this)', () => {
  const dir = makeCopy();
  const cache = path.join(dir, 'my-cache.json');
  const r = run(dir, [FIXTURE, '--offline', '--cache', cache]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(cache));
  assert.ok(!fs.existsSync(path.join(dir, '.agent-fleet')));
  assert.equal(run(dir, [FIXTURE, '--cache']).status, 1);
});

test('without sips: one clear note, no lookups at all', () => {
  const dir = makeCopy();
  const trap = path.join(dir, 'trap.mjs');
  fs.writeFileSync(trap, `import fs from 'node:fs';\nglobalThis.fetch = async (u) => { fs.appendFileSync(${JSON.stringify(path.join(dir, 'fetch.log'))}, u + '\\n'); throw new Error('x'); };\n`);
  const r = spawnSync(process.execPath, ['--import', trap, path.join(dir, 'scripts/build.mjs'), FIXTURE], { cwd: dir, encoding: 'utf8', env: { PATH: '', HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stderr.match(/"sips" was not found/g) || []).length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'fetch.log')));
});

test('sipsAvailable asks once and reports a missing tool', () => {
  assert.equal(sipsAvailable(() => ({ status: 0 })), true);
  assert.equal(sipsAvailable(() => ({ error: new Error('ENOENT') })), false);
});

test('a review flagged as a spoiler in the CSV is never published', () => {
  assert.equal(isTruthyFlag('true'), true);
  assert.equal(isTruthyFlag(''), false);
  const row = { 'Exclusive Shelf': 'read', 'Book Id': '1', Title: 'T', 'My Review': 'The butler did it.', Spoiler: 'true' };
  assert.equal(rowToBook(row).review, '');
  assert.equal(rowToBook({ ...row, Spoiler: '' }).review, 'The butler did it.');
  const header = 'Book Id,Title,Author,Exclusive Shelf,My Review,Spoiler,Date Read\n';
  const html = buildPages({ csvText: `${header}7,Spoiled,A B,read,The butler did it.,true,2026/01/01\n8,Fine,A B,read,Lovely.,,2026/01/02\n` }).pages['books.html'];
  assert.ok(!html.includes('butler'));
  assert.ok(section(html, 'b-7').includes('class="card"'));
  assert.ok(section(html, 'b-8').includes('class="letter"'));
});

test('reviews setting: all, chosen and none', () => {
  assert.equal(normalizeConfig({}).reviews, 'all');
  assert.equal(normalizeConfig({ reviews: 'chosen' }).reviews, 'chosen');
  assert.equal(normalizeConfig({ reviews: 'everything' }).reviews, 'all');
  assert.equal(normalizeConfig({ reviews: ['none'] }).reviews, 'all');
  const b = { id: '1', review: 'x' };
  assert.equal(applyReviewPolicy(b, 'all', {}).review, 'x');
  assert.equal(applyReviewPolicy(b, 'none', { 1: { showReview: true } }).review, '');
  assert.equal(applyReviewPolicy(b, 'chosen', {}).review, '');
  assert.equal(applyReviewPolicy(b, 'chosen', { 1: { showReview: 'yes' } }).review, '');
  assert.equal(applyReviewPolicy(b, 'chosen', { 1: { showReview: true } }).review, 'x');

  const extras = { 9000001: { showReview: true } };
  const build = (reviews) => buildPages({ csvText, extras, configRaw: { reviews } }).pages['books.html'];
  assert.ok(section(build('all'), 'b-9000001').includes('class="letter"'));
  assert.ok(section(build('chosen'), 'b-9000001').includes('class="letter"'));
  assert.ok(section(build('chosen'), 'b-9000002').includes('class="card"')); // Middlemarch has a review but was not chosen
  assert.ok(!build('none').includes('class="letter"'));
});

test('the notebook keeps ONE scroll box per page, however many years of essays there are', () => {
  const essays = ['2026-05-01', '2025-05-01', '2024-05-01', '2023-05-01', '2022-05-01', '2021-05-01'].map((d, i) => essay(`E${i}`, d));
  const html = buildPages({ csvText, essays }).pages['writing.html'];
  assert.equal((html.match(/class="page-in"/g) || []).length, 2); // left page, right page
  assert.equal((html.match(/<h2 class="year">/g) || []).length, 6);
  for (let i = 0; i < 6; i++) assert.ok(html.includes(`href="writing/E${i}.html"`));
  const left = html.slice(html.indexOf('class="page l"'), html.indexOf('class="page r"'));
  assert.equal((left.match(/class="page-in"/g) || []).length, 1);
  assert.deepEqual([...left.matchAll(/<h2 class="year">(\d+)/g)].map((m) => m[1]), ['2026', '2024', '2022']);
  const css = fs.readFileSync(path.join(REPO, 'assets/writing.css'), 'utf8');
  assert.equal((css.match(/^\.page-in\{/gm) || []).length, 1);
  assert.ok(!css.includes('.year + .page-in'));
  assert.match(css, /\.page-in\{[^}]*overflow-y:auto/);
});

const imgResponse = (over = {}) => ({
  status: 200, ok: true, url: 'https://archive.org/download/x.jpg',
  headers: { get: (k) => ({ 'content-type': 'image/jpeg', ...over.headers }[k.toLowerCase()]) },
  arrayBuffer: async () => new ArrayBuffer(over.size ?? 400),
  ...over.res,
});

test('cover download checks: host, image type, size', async () => {
  const toBmp = () => { throw new Error('should not be reached'); };
  const r1 = await fetchCoverColor('1', { fetchImpl: async () => imgResponse({ res: { url: 'https://evil.example.com/a.jpg' } }), toBmp });
  assert.match(r1.message, /unexpected host/);
  const r1b = await fetchCoverColor('1', { fetchImpl: async () => imgResponse({ res: { url: 'https://notopenlibrary.org/a.jpg' } }), toBmp });
  assert.match(r1b.message, /unexpected host/);
  const r2 = await fetchCoverColor('1', { fetchImpl: async () => imgResponse({ headers: { 'content-type': 'text/html' } }), toBmp });
  assert.match(r2.message, /not an image/);
  const r3 = await fetchCoverColor('1', { fetchImpl: async () => imgResponse({ headers: { 'content-length': '5000000' } }), toBmp });
  assert.match(r3.message, /too large/);
  const r4 = await fetchCoverColor('1', { fetchImpl: async () => imgResponse({ size: 1_500_000 }), toBmp });
  assert.match(r4.message, /too large/);
  // an allowed host passes the checks (and then reaches the converter)
  const r5 = await fetchCoverColor('1', { fetchImpl: async () => imgResponse({ res: { url: 'https://covers.openlibrary.org/b/id/1-S.jpg' } }), toBmp });
  assert.match(r5.message, /should not be reached/);
});

test('essay footer: the essay-substack meta is the single source of the footer link', () => {
  const html = '<footer>\n<!--substack-link-->\n<a href="old">x</a>\n<!--/substack-link-->\n</footer>';
  const out = applyEssayFooter(html, '<a href="new">y</a>');
  assert.equal(out.found, true);
  assert.ok(out.html.includes('href="new"') && !out.html.includes('href="old"'));
  assert.equal(applyEssayFooter('<footer></footer>', 'x').found, false);

  const dir = makeCopy();
  const file = path.join(dir, 'writing/placeholder-essay-one.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('content="https://your-name.substack.com/p/placeholder-essay-one"', 'content="https://zee.substack.com/p/changed"'));
  const r = run(dir, [FIXTURE, '--offline']);
  assert.equal(r.status, 0, r.stderr);
  const updated = fs.readFileSync(file, 'utf8');
  assert.ok(updated.includes('<a href="https://zee.substack.com/p/changed" target="_blank"'));
  assert.ok(!updated.includes('your-name.substack.com/p/placeholder-essay-one'));
});

test('committed essays already match their own essay-substack meta', () => {
  for (const f of fs.readdirSync(path.join(REPO, 'writing')).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(REPO, 'writing', f), 'utf8');
    const e = parseEssay(html, f);
    assert.ok(html.includes(`<a href="${e.substackUrl}" target="_blank"`), f);
  }
});

test('the essay template lives in docs/, not in the served writing/ folder', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'docs/essay-template.html')));
  assert.ok(!fs.existsSync(path.join(REPO, 'writing/_template.html')));
});

test('study tab order follows the visual order: top row first', () => {
  const html = buildPages({ csvText }).pages['index.html'];
  const room = html.slice(html.indexOf('fit-room'), html.indexOf('wall-fit'));
  const order = [...room.matchAll(/<a class="obj (\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['painting', 'postcard', 'shelf', 'desk', 'peg', 'resume', 'linkedin']);
});

test('.gitignore: PDFs need an explicit opt-in and only the one fixture CSV is allowed', () => {
  const g = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split('\n');
  assert.ok(g.includes('*.pdf'));
  assert.ok(g.includes('*.csv'));
  assert.ok(g.includes('!tests/fixtures/sample-goodreads.csv'));
  assert.ok(!g.some((l) => /^!.*\*/.test(l)));
});
