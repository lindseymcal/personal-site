// Tester's extra tests: running the real build script (in a throwaway COPY of the repo, never the real one),
// idempotence, --offline, the color cache, empty and huge libraries.
// SAFETY: every CLI run passes an explicit CSV path from tests/fixtures or a temp file. The build is never
// run without a path (that would read the real Goodreads export).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchCoverColor, fillColorCache } from '../src/cover.mjs';
import { buildPages } from '../src/build-site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests/fixtures/sample-goodreads.csv');

// Copy only what the build needs into a temp folder.
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-copy-'));
  made.push(dir);
  for (const item of ['scripts', 'src', 'content', 'writing', 'site.config.json', 'package.json', 'assets']) {
    fs.cpSync(path.join(REPO, item), path.join(dir, item), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}

// A file loaded with --import that replaces fetch: records every call, then fails like a dead network.
function writeFetchTrap(dir) {
  const trap = path.join(dir, 'trap.mjs');
  fs.writeFileSync(trap, `import fs from 'node:fs';
globalThis.fetch = async (url) => { fs.appendFileSync(${JSON.stringify(path.join(dir, 'fetch.log'))}, String(url) + '\\n'); throw new Error('network blocked by test'); };
`);
  return trap;
}

function runBuild(dir, csv, flags = [], { trap } = {}) {
  assert.ok(csv && path.isAbsolute(csv), 'tests must always pass an explicit absolute CSV path');
  const args = [...(trap ? ['--import', trap] : []), path.join(dir, 'scripts/build.mjs'), csv, ...flags];
  return spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
}

function snapshot(dir) {
  const out = {};
  for (const d of ['.', 'projects', 'content']) {
    for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) {
      if (e.isFile() && /\.(html|json)$/.test(e.name)) out[path.join(d, e.name)] = fs.readFileSync(path.join(dir, d, e.name), 'utf8');
    }
  }
  return out;
}

test('the build script refuses a missing CSV path with a helpful message (and does not touch the real export)', () => {
  const dir = makeCopy();
  const r = runBuild(dir, path.join(dir, 'nope.csv'), ['--offline']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Can't find the Goodreads export/);
});

test('--offline: two builds are byte-identical, and fetch is never called', () => {
  const dir = makeCopy();
  const trap = writeFetchTrap(dir);
  const a = runBuild(dir, FIXTURE, ['--offline'], { trap });
  assert.equal(a.status, 0, a.stderr);
  const first = snapshot(dir);
  const b = runBuild(dir, FIXTURE, ['--offline'], { trap });
  assert.equal(b.status, 0, b.stderr);
  const second = snapshot(dir);
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  for (const k of Object.keys(first)) assert.equal(second[k], first[k], `${k} changed between identical builds`);
  assert.ok(!fs.existsSync(path.join(dir, 'fetch.log')), 'fetch was called under --offline: ' + (fs.existsSync(path.join(dir, 'fetch.log')) && fs.readFileSync(path.join(dir, 'fetch.log'), 'utf8')));
});

test('control: without --offline the trap DOES see fetches for ISBNs not in the cache (so the offline test above is meaningful)', () => {
  const dir = makeCopy();
  const trap = writeFetchTrap(dir);
  const r = runBuild(dir, FIXTURE, [], { trap });
  assert.equal(r.status, 0, r.stderr);
  const log = fs.readFileSync(path.join(dir, 'fetch.log'), 'utf8');
  assert.match(log, /^https:\/\/covers\.openlibrary\.org\/b\/isbn\//m);
  // network errors are not cached: the cache file stays empty so the next build retries
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.agent-fleet/goodreads/spine-colors.json'), 'utf8')), {});
  assert.match(r.stdout, /failed \(will retry next build\)/);
}, { timeout: 120_000 });

test('the build only writes the expected files and deletes stale project pages', () => {
  const dir = makeCopy();
  fs.writeFileSync(path.join(dir, 'projects/stale-old-project.html'), 'old');
  fs.writeFileSync(path.join(dir, 'projects/notes.txt'), 'keep me');
  const r = runBuild(dir, FIXTURE, ['--offline']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, 'projects/stale-old-project.html')));
  assert.ok(fs.existsSync(path.join(dir, 'projects/notes.txt')), 'non-html files in projects/ must be left alone');
  for (const f of ['index.html', 'books.html', 'writing.html', 'projects.html']) assert.ok(fs.existsSync(path.join(dir, f)), f);
});

test('invalid JSON in a content file stops the build with a message naming the file', () => {
  const dir = makeCopy();
  fs.writeFileSync(path.join(dir, 'content/books-extra.json'), '{ "1": { "favorite": true, } }');
  const r = runBuild(dir, FIXTURE, ['--offline']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /books-extra\.json is not valid JSON/);
});

test('a site.config.json that holds JSON null falls back to defaults instead of crashing', () => {
  const dir = makeCopy();
  fs.writeFileSync(path.join(dir, 'site.config.json'), 'null');
  const r2 = runBuild(dir, FIXTURE, ['--offline']);
  assert.equal(r2.status, 0, `site.config.json containing "null" should fall back to defaults; got: ${r2.stderr}`);
});

test('an essay with a bad date or title is reported as a warning naming the file; the build still finishes', () => {
  const dir = makeCopy();
  fs.writeFileSync(path.join(dir, 'writing/broken.html'), '<meta name="essay-title" content="x"><meta name="essay-date" content="soon">');
  const r = runBuild(dir, FIXTURE, ['--offline']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /broken\.html/);
});

test('an empty CSV (header only) and a totally empty file build every page without crashing', () => {
  for (const content of ['Book Id,Title,Exclusive Shelf\n', '', '﻿', 'garbage with no commas\n']) {
    const dir = makeCopy();
    const csv = path.join(dir, 'empty.csv');
    fs.writeFileSync(csv, content);
    const r = runBuild(dir, csv, ['--offline']);
    assert.equal(r.status, 0, `${JSON.stringify(content)}: ${r.stderr}`);
    assert.match(r.stdout, /Read 0 books/);
    const books = fs.readFileSync(path.join(dir, 'books.html'), 'utf8');
    assert.ok(books.includes('class="bookend"'));
    assert.ok(!books.includes('undefined') && !books.includes('NaN'));
    const home = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(!home.includes('undefined') && !home.includes('NaN'));
  }
});

test('empty library, no projects, no essays: pages still have their routes and no "undefined"', () => {
  const { pages } = buildPages({ csvText: '', projectsRaw: [], essays: [] });
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!/undefined|NaN|\[object/.test(html), name);
  }
  assert.match(pages['writing.html'], /Nothing written here yet/);
  assert.ok(pages['index.html'].includes('href="books.html"'));
});

test('a huge library (3000 books, long reviews) builds quickly and every book has a spine and a card', () => {
  const header = 'Book Id,Title,Author,Author l-f,ISBN,ISBN13,My Rating,Number of Pages,Original Publication Year,Year Published,Date Read,Date Added,Exclusive Shelf,My Review';
  const rows = Array.from({ length: 3000 }, (_, i) => `${100000 + i},"Book number ${i}","Author ${i}","Author, ${i}",,,${i % 6},${50 + (i * 7) % 900},${1500 + (i % 520)},,${2000 + (i % 25)}/0${1 + (i % 9)}/1${i % 9},2000/01/01,read,"${'Great. '.repeat(100)}<br/>More"`);
  const started = Date.now();
  const { pages } = buildPages({ csvText: [header, ...rows].join('\n'), projectsRaw: [{ title: 'P' }] });
  const ms = Date.now() - started;
  assert.ok(ms < 10_000, `took ${ms} ms`);
  assert.equal((pages['books.html'].match(/<a class="spine/g) || []).length, 3000);
  assert.equal((pages['books.html'].match(/<section class="pull"/g) || []).length, 3000);
  const ids = [...pages['books.html'].matchAll(/ id="(s-\d+|b-\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate DOM ids');
  // home shelf is capped, not 3000 spines
  assert.ok((pages['index.html'].match(/class="sp[ "]/g) || []).length < 400);
  // every tier stays within the case width
  assert.ok(!pages['books.html'].includes('NaN'));
});

// ---- cover color cache, end to end through the real fetchCoverColor ----------------------------------------

const res = (code, bytes = 0) => ({ status: code, ok: code >= 200 && code < 300, arrayBuffer: async () => new ArrayBuffer(bytes) });

test('cache: a 404 is stored as null and is not asked again; a network error is not stored and is asked again', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.includes('NOCOVER')) return res(404);
    if (url.includes('FLAKY')) throw new Error('ECONNRESET');
    if (url.includes('SERVERERR')) return res(500);
    return res(200, 10); // tiny: "no cover"
  };
  const fetchColor = (isbn) => fetchCoverColor(isbn, { fetchImpl });
  const first = await fillColorCache(['NOCOVER', 'FLAKY', 'SERVERERR', 'TINY'], {}, { fetchColor, pauseMs: 0 });
  assert.deepEqual(first.cache, { NOCOVER: null, TINY: null });
  assert.equal(first.failed, 2);
  asked.length = 0;
  const second = await fillColorCache(['NOCOVER', 'FLAKY', 'SERVERERR', 'TINY'], first.cache, { fetchColor, pauseMs: 0 });
  assert.deepEqual(asked.map((u) => u.match(/isbn\/([A-Z]+)-/)[1]).sort(), ['FLAKY', 'SERVERERR']);
  assert.deepEqual(second.cache, first.cache);
});

test('cache: --refresh-colors retries nulls only, never overwrites a real color; input cache object is not mutated', async () => {
  const cache = { A: null, B: '#123456' };
  const asked = [];
  const r = await fillColorCache(['A', 'B'], cache, { refresh: true, fetchColor: async (i) => { asked.push(i); return { status: 'none' }; }, pauseMs: 0 });
  assert.deepEqual(asked, ['A']);
  assert.equal(r.cache.B, '#123456');
  assert.deepEqual(cache, { A: null, B: '#123456' });
});

test('cache: duplicate and empty ISBNs are asked once / never', async () => {
  const asked = [];
  await fillColorCache(['X', 'X', '', undefined, 'X'], {}, { fetchColor: async (i) => { asked.push(i); return { status: 'none' }; }, pauseMs: 0 });
  assert.deepEqual(asked, ['X']);
});

test('fetchCoverColor: a redirect-following fetch is asked with a timeout signal and only ever for covers.openlibrary.org', async () => {
  let seen;
  await fetchCoverColor('0141439688', { fetchImpl: async (url, opts) => { seen = { url, opts }; return res(404); } });
  assert.equal(new URL(seen.url).host, 'covers.openlibrary.org');
  assert.ok(seen.opts.signal, 'no timeout signal');
});

test('fetchCoverColor: an ISBN is URL-encoded so it cannot change the request path', async () => {
  let url;
  await fetchCoverColor('1/../../x?y#z', { fetchImpl: async (u) => { url = u; return res(404); } });
  assert.equal(new URL(url).pathname.split('/').length, 4);
  assert.equal(new URL(url).host, 'covers.openlibrary.org');
});
