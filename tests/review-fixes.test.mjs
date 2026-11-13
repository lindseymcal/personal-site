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
import { normalizeConfig } from '../src/site.mjs';
import { normalizeEntry } from '../src/feed.mjs';
import { fetchCoverColor, sipsAvailable } from '../src/cover.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests/fixtures/sample-goodreads.csv');
const csvText = fs.readFileSync(FIXTURE, 'utf8');

const made = [];
after(() => { for (const d of made) for (const x of [d, `${d}-c.json`, `${d}-my-cache.json`]) fs.rmSync(x, { recursive: true, force: true }); });
function tempDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')); made.push(d); return d; }
function makeCopy() {
  const dir = tempDir();
  for (const item of ['scripts', 'src', 'content', 'site.config.json', 'package.json', 'assets']) fs.cpSync(path.join(REPO, item), path.join(dir, item), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}
const run = (dir, args, env = {}) => spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), ...(args.includes('--cache') || args.length === 0 ? args : [...args, '--cache', `${dir}-c.json`])], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir, ...env } });
const essay = (t, d) => normalizeEntry({ title: t, url: `https://lindseymcal.substack.com/p/${t}`, date: d });
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
  assert.match(scripts['build:sample'], /--cache-seed tests\/fixtures\/sample-spine-colors\.json/);
  assert.match(scripts.build, /goodreads_library_export\.csv/);
});

test('the color cache lives outside the repo, and is pruned to the books in this build', () => {
  const dir = makeCopy();
  // a copy of the fixture placed at the (temp-HOME) default path counts as "the real export" for this test
  const real = path.join(dir, '.agent-fleet/goodreads/goodreads_library_export.csv');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.copyFileSync(FIXTURE, real);
  const cache = path.join(dir, '.agent-fleet/goodreads/spine-colors.json');
  const colors = { 9780141439686: '#123456' };
  for (let i = 0; i < 3; i++) colors[`11111111111${i}`] = '#abcdef'; // 3 stale of 4: more than half
  fs.writeFileSync(cache, JSON.stringify(colors));
  const refused = run(dir, [real, '--offline', '--cache', cache]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /would forget 3 of the 4/);
  assert.deepEqual(JSON.parse(fs.readFileSync(cache, 'utf8')), colors, 'a refused build must not touch the cache');
  assert.ok(!fs.existsSync(path.join(dir, 'index.html')), 'a refused build must not write pages');
  // with the real default path the default cache is used without --cache; --prune allows the big prune
  const ok = spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), real, '--offline', '--prune'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(cache, 'utf8')), { 9780141439686: '#123456' });
  assert.ok(!fs.existsSync(path.join(dir, 'content/spine-colors.json')));
  assert.ok(!fs.existsSync(path.join(REPO, 'content/spine-colors.json')), 'the repo must not carry a cache of ISBNs');
});

test('a small prune (half or fewer) is allowed without --prune', () => {
  const dir = makeCopy();
  const cache = `${dir}-c.json`;
  fs.writeFileSync(cache, JSON.stringify({ 9780141439686: '#123456', 1111111111111: '#abcdef' }));
  const r = run(dir, [FIXTURE, '--offline', '--cache', cache]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(cache, 'utf8')), { 9780141439686: '#123456' });
});

test('any CSV other than the real default needs --cache (the real cache is never used by accident)', () => {
  const dir = makeCopy();
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), FIXTURE, '--offline'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--cache/);
  assert.ok(!fs.existsSync(path.join(dir, '.agent-fleet')));
  assert.ok(!fs.existsSync(path.join(dir, 'index.html')));
});

test('a wrong file or an empty library stops the build before anything is written, unless --allow-empty', () => {
  for (const [name, content] of [['wrong.csv', 'Name,Email\na,b\n'], ['empty.csv', 'Book Id,Title,Exclusive Shelf\n1,Only to read,to-read\n']]) {
    const dir = makeCopy();
    const csv = `${dir}-${name}`;
    fs.writeFileSync(csv, content);
    const cache = `${dir}-c.json`;
    fs.writeFileSync(cache, JSON.stringify({ 9780141439686: '#123456' }));
    const r = run(dir, [csv, '--offline', '--cache', cache]);
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, /Nothing was changed/, name);
    assert.deepEqual(JSON.parse(fs.readFileSync(cache, 'utf8')), { 9780141439686: '#123456' }, `${name}: cache must be untouched`);
    assert.ok(!fs.existsSync(path.join(dir, 'index.html')), name);
    assert.equal(run(dir, [csv, '--offline', '--cache', cache, '--allow-empty', '--prune']).status, 0, name);
  }
});

test('build:sample writes a preview and changes nothing outside preview/', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts;
  assert.match(scripts['build:sample'], /--out preview/);
  assert.match(scripts['build:sample'], /--cache preview\/spine-colors\.json/);
  const dir = makeCopy();
  const snap = () => {
    const out = {};
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (f !== path.join(dir, 'preview')) walk(f); } else out[path.relative(dir, f)] = fs.readFileSync(f, 'utf8'); } };
    walk(dir);
    return out;
  };
  fs.writeFileSync(path.join(dir, 'index.html'), 'REAL PAGE');
  fs.writeFileSync(path.join(dir, 'books.html'), 'REAL BOOKS');
  fs.writeFileSync(path.join(dir, 'projects/real-project.html'), 'REAL PROJECT');
  const before = snap();
  const sampleArgs = scripts['build:sample'].replace('node scripts/build.mjs ', '').split(' ').map((a) => (a.startsWith('tests/') || a.startsWith('preview') ? path.join(dir, a) : a));
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), FIXTURE, ...sampleArgs.slice(1), '--offline'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(snap(), before, 'something outside preview/ changed');
  for (const f of ['index.html', 'books.html', 'writing.html', 'projects.html', 'projects/agent-fleet.html', 'assets/site.css']) {
    assert.ok(fs.existsSync(path.join(dir, 'preview', f)), `preview/${f}`);
  }
  assert.notEqual(fs.readFileSync(path.join(dir, 'preview/index.html'), 'utf8'), 'REAL PAGE');
  assert.ok(!fs.existsSync(path.join(dir, '.agent-fleet')));
  assert.ok(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split('\n').includes('preview/'));
});

test('--cache points the build at another cache file (the sample build uses this)', () => {
  const dir = makeCopy();
  const cache = `${dir}-my-cache.json`;
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
  const r = spawnSync(process.execPath, ['--import', trap, path.join(dir, 'scripts/build.mjs'), FIXTURE, '--cache', `${dir}-c.json`], { cwd: dir, encoding: 'utf8', env: { PATH: '', HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stderr.match(/"sips" was not found/g) || []).length, 1);
  // the one request the build may make is the Substack feed; there must be no cover lookups
  const log = fs.existsSync(path.join(dir, 'fetch.log')) ? fs.readFileSync(path.join(dir, 'fetch.log'), 'utf8') : '';
  assert.ok(!/openlibrary/.test(log), log);
});

test('sipsAvailable asks once and reports a missing tool', () => {
  assert.equal(sipsAvailable(() => ({ status: 0 })), true);
  assert.equal(sipsAvailable(() => ({ error: new Error('ENOENT') })), false);
});

test('a review flagged as a spoiler in the CSV is never published', () => {
  for (const v of ['true', 'TRUE', 'yes', '1', 'x', 'spoiler', ' true ']) assert.equal(isTruthyFlag(v), true, v);
  for (const v of ['', ' ', 'false', 'False', 'no', '0', undefined]) assert.equal(isTruthyFlag(v), false, String(v));
  const row = { 'Exclusive Shelf': 'read', 'Book Id': '1', Title: 'T', 'My Review': 'The butler did it.', Spoiler: 'true' };
  assert.equal(rowToBook(row).review, '');
  assert.equal(rowToBook({ ...row, Spoiler: '' }).review, 'The butler did it.');
  const header = 'Book Id,Title,Author,Exclusive Shelf,My Review,Spoiler,Date Read\n';
  const html = buildPages({ csvText: `${header}7,Spoiled,A B,read,The butler did it.,true,2026/01/01\n8,Fine,A B,read,Lovely.,,2026/01/02\n`, configRaw: { reviews: 'all' }, extras: { 7: { showReview: true } } }).pages['books.html'];
  assert.ok(!html.includes('butler'));
  assert.ok(section(html, 'b-7').includes('class="card"'));
  assert.ok(section(html, 'b-8').includes('class="letter"'));
});

test('reviews setting: chosen (the default), all and none', () => {
  assert.equal(normalizeConfig({}).reviews, 'chosen'); // fails closed when the setting is missing
  assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'site.config.json'), 'utf8')).reviews, 'chosen');
  assert.equal(normalizeConfig({ reviews: 'chosen' }).reviews, 'chosen');
  // fails closed: a mistake never publishes more than intended
  for (const bad of ['everything', 'Chosen', 'chosen ', 'ALL', '', null, ['all'], 1]) assert.equal(normalizeConfig({ reviews: bad }).reviews, 'none', JSON.stringify(bad));
  assert.ok(buildPages({ csvText, configRaw: { reviews: 'Chosen' } }).warnings.some((w) => /reviews must be exactly/.test(w)));
  assert.ok(!buildPages({ csvText, configRaw: {} }).warnings.some((w) => /reviews must be/.test(w)));
  const b = { id: '1', review: 'x' };
  assert.equal(applyReviewPolicy(b, 'all', {}).review, 'x');
  assert.equal(applyReviewPolicy(b, 'none', { 1: { showReview: true } }).review, '');
  assert.equal(applyReviewPolicy(b, 'chosen', {}).review, '');
  assert.equal(applyReviewPolicy(b, 'chosen', { 1: { showReview: 'yes' } }).review, '');
  assert.equal(applyReviewPolicy(b, 'chosen', { 1: { showReview: true } }).review, 'x');

  const extras = { 9000001: { showReview: true } };
  const build = (reviews) => buildPages({ csvText, extras, configRaw: reviews === undefined ? {} : { reviews } }).pages['books.html'];
  assert.ok(!build(undefined).includes('class="letter"') || section(build(undefined), 'b-9000001').includes('class="letter"'));
  assert.ok(section(build(undefined), 'b-9000002').includes('class="card"')); // default is chosen: unmarked reviews stay private
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
  for (let i = 0; i < 6; i++) assert.ok(html.includes(`href="https://lindseymcal.substack.com/p/E${i}"`));
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

test('--out may only be preview/ (or inside it); anything else is refused and nothing is written', () => {
  for (const out of ['.', '..', os.homedir() + '/.agent-fleet', '/tmp', 'projects', 'preview/../x']) {
    const dir = makeCopy();
    fs.writeFileSync(path.join(dir, 'index.html'), 'REAL');
    const home = tempDir();
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), FIXTURE, '--offline', '--cache', `${dir}-c.json`, '--out', out], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(r.status, 1, `--out ${out}`);
    assert.match(r.stderr, /--out may only be the site folder or the preview folder/, out);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'REAL', out);
    assert.ok(!fs.existsSync(path.join(dir, 'books.html')), out);
    assert.ok(!fs.existsSync(`${dir}-c.json`), out);
    assert.deepEqual(fs.readdirSync(home), [], `${out}: HOME must stay empty`);
  }
  // preview itself and a folder inside it are fine
  const dir = makeCopy();
  assert.equal(run(dir, [FIXTURE, '--offline', '--out', path.join(dir, 'preview/deep')]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'preview/deep/index.html')));
});

test('a color cache inside the repo (outside preview/) is refused', () => {
  const dir = makeCopy();
  for (const inside of ['cache.json', 'content/spine-colors.json', 'tests/c.json']) {
    const r = run(dir, [FIXTURE, '--offline', '--cache', path.join(dir, inside)]);
    assert.equal(r.status, 1, inside);
    assert.match(r.stderr, /must not be inside the repo/);
    assert.ok(!fs.existsSync(path.join(dir, inside)), inside);
    assert.ok(!fs.existsSync(path.join(dir, 'index.html')));
  }
  assert.equal(run(dir, [FIXTURE, '--offline', '--cache', path.join(dir, 'preview/c.json'), '--out', path.join(dir, 'preview')]).status, 0);
});

test('the color cache is private (0600) on every write, even when the file already existed', () => {
  const dir = makeCopy();
  const cache = `${dir}-c.json`;
  fs.writeFileSync(cache, '{}', { mode: 0o644 });
  fs.chmodSync(cache, 0o644);
  const r = run(dir, [FIXTURE, '--offline', '--cache', cache]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(cache).mode & 0o777, 0o600);
});

test('error messages and README show the npm form of the flags', () => {
  const build = fs.readFileSync(path.join(REPO, 'scripts/build.mjs'), 'utf8');
  assert.ok(build.includes('npm run build -- --allow-empty') && build.includes('npm run build -- --prune'));
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.match(readme, /npm run build -- --prune/);
  assert.match(readme, /npm run build -- --allow-empty/);
  assert.match(readme, /Export from Goodreads once before your first `npm run build`/);
});

test('a CSV inside the repo is refused (only tests/fixtures may hold one); keep exports in ~/.agent-fleet/goodreads/', () => {
  const dir = makeCopy();
  for (const inside of ['export.csv', 'content/goodreads_library_export.csv', 'sample-goodreads.csv']) {
    const csv = path.join(dir, inside);
    fs.writeFileSync(csv, fs.readFileSync(FIXTURE));
    const r = run(dir, [csv, '--offline']);
    assert.equal(r.status, 1, inside);
    assert.match(r.stderr, /inside the repo/);
    assert.match(r.stderr, /~\/\.agent-fleet\/goodreads\//);
    assert.ok(!fs.existsSync(path.join(dir, 'index.html')), inside);
  }
  // a relative path that reaches in is refused too
  const rel = spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), 'export.csv', '--offline', '--cache', `${dir}-c.json`], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.match(rel.stderr, /inside the repo/);
  // the fixture folder is the one allowed place (checked against the real repo's fixtures path)
  assert.equal(run(dir, [FIXTURE, '--offline']).status, 0);
});

test('.gitignore keeps exports and spreadsheets out of git, anywhere in the repo', () => {
  const ignored = ['export.csv', 'content/goodreads_library_export.numbers', 'content/books.numbers', 'a/b/c.xlsx', 'x.xls', 'x.ods', 'x.tsv', 'goodreads_anything.txt', 'content/goodreads_library_export (1).csv', 'deep/er/goodreads_library_export.txt', 'site/index.html', 'resume.pdf', 'preview/index.html'];
  for (const f of ignored) {
    const r = spawnSync('git', ['check-ignore', '-q', f], { cwd: REPO });
    assert.equal(r.status, 0, `${f} should be git-ignored`);
  }
  for (const f of ['tests/fixtures/sample-goodreads.csv', 'content/books-extra.json', 'index.html', 'tests/fixtures/sample-spine-colors.json']) {
    assert.equal(spawnSync('git', ['check-ignore', '-q', f], { cwd: REPO }).status, 1, `${f} must stay tracked`);
  }
});
