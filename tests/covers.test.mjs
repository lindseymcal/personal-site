// The --covers preview: cover stats, the label rules from the designer, the safety rules for the flag,
// and the page thickness. SAFETY: CLI runs use the fixture or temp CSVs, a temp HOME, and a fake fetch.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coverStats, BUSY_STD_DEV } from '../src/coverstats.mjs';
import { coverLabelColors, coverSpineLayout, spineStyle, spineWidth, COVER_MIN_FONT, PAPER_LABEL } from '../src/spine.mjs';
import { contrastRatio, hexToRgb, rgbToHex } from '../src/color.mjs';
import { fetchCoverImage, fillCoverFolder, sipsAvailable } from '../src/cover.mjs';
import { buildPages, validCoverStats } from '../src/build-site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests/fixtures/sample-goodreads.csv');
const csvText = fs.readFileSync(FIXTURE, 'utf8');

const made = [];
after(() => { for (const d of made) for (const x of [d, `${d}-c.json`]) fs.rmSync(x, { recursive: true, force: true }); });
function tempDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-')); made.push(d); return d; }

const solid = (w, h, rgb) => ({ width: w, height: h, data: Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])) });
const checker = (w, h, a, b) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = (x + y) % 2 ? a : b; d.set([...c, 255], (y * w + x) * 4); } return { width: w, height: h, data: d }; };

test('coverStats: a flat cover is calm, with its own color as the main color', () => {
  const s = coverStats(solid(40, 60, [120, 60, 40]));
  assert.equal(s.main, '#783c28');
  assert.equal(s.busy, false);
  assert.equal(s.dark, s.light);
});

test('coverStats: a black-and-white checkerboard is very busy, with extremes found', () => {
  const s = coverStats(checker(60, 90, [250, 250, 250], [10, 10, 10]));
  assert.equal(s.busy, true);
  assert.ok(s.std > BUSY_STD_DEV);
  assert.ok(contrastRatio(s.dark, s.light) > 10);
});

test('coverStats ignores transparent pixels and refuses an empty strip', () => {
  assert.throws(() => coverStats({ width: 4, height: 4, data: new Uint8Array(64) }), /no visible pixels/);
});

test('label colors: whatever the cover, the label text reaches 4.5:1 over both the darkest and lightest pixel (or the paper label is used)', () => {
  const steps = [0, 60, 120, 180, 240];
  let colorLabels = 0, paperLabels = 0;
  for (const r of steps) for (const g of steps) for (const b of steps) {
    const main = rgbToHex([r, g, b]);
    for (const [dark, light] of [['#000000', '#ffffff'], ['#101020', '#e0e0d0'], [main, main], ['#202020', '#f0d0a0']]) {
      const l = coverLabelColors({ main, dark, light, busy: false });
      if (l.kind === 'paper') { paperLabels++; assert.equal(l.bg, PAPER_LABEL.bg); assert.ok(contrastRatio(l.bg, l.text) >= 4.5); continue; }
      colorLabels++;
      const blend = (under) => rgbToHex(hexToRgb(main).map((v, i) => v * 0.88 + hexToRgb(under)[i] * 0.12));
      for (const under of [dark, light]) assert.ok(contrastRatio(blend(under), l.text) >= 4.5, `${main} over ${under}`);
      assert.match(l.bg, /^rgba\(\d+,\d+,\d+,0\.88\)$/);
    }
  }
  assert.ok(colorLabels > 100 && paperLabels >= 0);
});

test('label colors: busy covers get the cream paper label with dark ink', () => {
  const l = coverLabelColors({ main: '#223344', dark: '#000000', light: '#ffffff', busy: true });
  assert.deepEqual([l.kind, l.bg, l.text], ['paper', '#F4ECD8', '#2A2620']);
});

test('label colors: a dark cover gets light text, a light cover gets dark ink', () => {
  assert.equal(coverLabelColors({ main: '#14204a', dark: '#101830', light: '#203060', busy: false }).text, '#FBF3E2');
  assert.equal(coverLabelColors({ main: '#f3e2cf', dark: '#d0c0b0', light: '#fff8f0', busy: false }).text, '#1B1713');
});

const bookOf = (over) => ({ title: 'T', spineTitle: 'A Rather Long Title For A Cover', spineAuthor: 'Someone', pages: 300, pubYear: 1900, color: '', favorite: false, ...over });
const stats = { main: '#5e7a49', dark: '#203018', light: '#c0d0a0', busy: false };

test('cover spine layout: titles stay at 11px or larger, the label is the 15%..91% band, thin spines drop the author', () => {
  for (const pages of [1, 50, 100, 300, 800, 2000]) for (const spineTitle of ['It', 'The Hitchhiker\'s Guide to the Galaxy', 'x'.repeat(150)]) {
    const book = bookOf({ pages, spineTitle });
    const st = spineStyle(book, undefined);
    const lay = coverSpineLayout(book, st, stats);
    assert.ok(lay.fontSize >= COVER_MIN_FONT, `${pages} pages: ${lay.fontSize}`);
    assert.equal(lay.showAuthor, st.width >= 28, `width ${st.width}`);
    assert.ok(lay.lines.length >= 1);
  }
  const thin = spineStyle(bookOf({ pages: 1 }), undefined);
  assert.equal(thin.width, 26);
  assert.equal(coverSpineLayout(bookOf({ pages: 1 }), thin, stats).showAuthor, false);
});

test('thickness is linear in page count over a wide clamp, with a default when pages are missing', () => {
  assert.equal(spineWidth(0), 44);
  assert.ok(spineWidth(100) < 35 && spineWidth(850) >= 90 && spineWidth(5000) === 96);
  for (const [a, b] of [[100, 300], [300, 600], [200, 700]]) assert.ok(Math.abs((spineWidth(b) - spineWidth(a)) - (b - a) * 0.085) <= 1);
});

test('cover stats read from a cache file are checked before they go into a page', () => {
  assert.equal(validCoverStats(stats), true);
  for (const bad of [null, {}, { ...stats, main: 'red' }, { ...stats, main: '#fff;background:url(x)' }, { ...stats, busy: 'yes' }, { ...stats, dark: undefined }]) assert.ok(!validCoverStats(bad));
  const isbn = '9780141439686'; // Persuasion in the fixture
  const html = buildPages({ csvText, covers: { [isbn]: { ...stats, main: '#fff;x:url(//evil)' } } }).pages['books.html'];
  assert.ok(!html.includes('evil'));
  assert.ok(!html.includes('class="cut"'));
});

test('with covers: lazy local images on spines, the full cover when pulled out, generated spines for books without one', () => {
  const isbn = '9780141439686';
  const dark = { main: '#2a3a5a', dark: '#101830', light: '#506080', busy: false };
  const { pages } = buildPages({ csvText, covers: { [isbn]: dark } });
  const html = pages['books.html'];
  assert.match(html, new RegExp(`<img class="cut" src="covers/${isbn}\\.jpg" alt="" loading="lazy"`));
  assert.match(html, new RegExp(`<img class="front" src="covers/${isbn}\\.jpg" alt="Cover of Persuasion" loading="lazy"`));
  assert.equal((html.match(/class="spine cv/g) || []).length, 1);
  assert.ok((html.match(/class="spine(?! cv)/g) || []).length > 20); // everyone else keeps the generated spine
  for (const m of html.matchAll(/<img [^>]*src="([^"]*)"/g)) assert.match(m[1], /^covers\/[0-9X]{10,13}\.jpg$/, 'only local relative paths');
  // labels follow the rules: solid label from the cover's own color, inset by the CSS
  assert.match(html, /--lbl:rgba\(42,58,90,0\.88\)/);
  assert.ok(!/covers\//.test(pages['index.html']), 'the study home shelf has no cover pictures');
});

test('without covers the pages contain no image paths at all (the real site never carries covers)', () => {
  const { pages } = buildPages({ csvText });
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!html.includes('covers/'), name);
    // the only picture is Zee's painting in the study (a local file shipped on purpose)
    const imgs = [...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(imgs, name === 'index.html' ? ['assets/art/fort-point-fog.jpg', 'assets/art/fort-point-fog.jpg'] : [], name);
  }
});

test('.gitignore blocks any covers/ folder', () => {
  assert.ok(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split('\n').includes('covers/'));
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'covers/123.jpg'], { cwd: REPO }).status, 0);
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'preview/covers/123.jpg'], { cwd: REPO }).status, 0);
});

const img = (over = {}) => ({
  status: 200, ok: true, url: 'https://archive.org/x.jpg',
  headers: { get: (k) => ({ 'content-type': 'image/jpeg', ...over.headers }[k.toLowerCase()]) },
  arrayBuffer: async () => { const b = new Uint8Array(over.size ?? 500); b.set(over.magic ?? [0xff, 0xd8, 0xff, 0xe0]); return b.buffer; },
  ...over.res,
});

test('cover picture download: same checks as the color lookup, and it must really be a JPEG', async () => {
  assert.equal((await fetchCoverImage('1', { fetchImpl: async () => img() })).status, 'ok');
  assert.match((await fetchCoverImage('1', { fetchImpl: async () => img({ res: { url: 'https://evil.example.com/a.jpg' } }) })).message, /unexpected host/);
  assert.match((await fetchCoverImage('1', { fetchImpl: async () => img({ headers: { 'content-type': 'text/html' } }) })).message, /not an image/);
  assert.match((await fetchCoverImage('1', { fetchImpl: async () => img({ size: 1_500_000 }) })).message, /too large/);
  assert.match((await fetchCoverImage('1', { fetchImpl: async () => img({ magic: [0x3c, 0x68, 0x74, 0x6d] }) })).message, /not a JPEG/);
  assert.deepEqual(await fetchCoverImage('1', { fetchImpl: async () => ({ status: 404, ok: false }) }), { status: 'none' });
});

test('cover folder: private modes, skips cached ones, remembers "no cover", never fetches offline', async () => {
  const dir = path.join(tempDir(), 'covers');
  const asked = [];
  const fetchImage = async (isbn) => { asked.push(isbn); return isbn === '9780000000002' ? { status: 'none' } : { status: 'ok', bytes: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]) }; };
  const analyze = () => stats;
  const first = await fillCoverFolder(['9780000000001', '9780000000002', '9780000000001', 'bad isbn', ''], dir, { fetchImage, analyze, pauseMs: 0 });
  assert.deepEqual(asked, ['9780000000001', '9780000000002']);
  assert.deepEqual([first.found, first.none, first.failed], [1, 1, 0]);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['9780000000001.jpg', '9780000000001.json', '9780000000002.none']);
  asked.length = 0;
  const second = await fillCoverFolder(['9780000000001', '9780000000002', '9780000000003'], dir, { fetchImage, analyze, pauseMs: 0, offline: true });
  assert.deepEqual(asked, []);
  assert.equal(second.found, 1);
  const third = await fillCoverFolder(['9780000000001', '9780000000002', '9780000000003'], dir, { fetchImage, analyze, pauseMs: 0 });
  assert.deepEqual(asked, ['9780000000003']); // only the new one is downloaded
  assert.equal(third.found, 2);
});

const runBuild = (dir, args, env = {}) => spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir, ...env } });
function makeCopy() {
  const dir = tempDir();
  for (const item of ['scripts', 'src', 'content', 'writing', 'site.config.json', 'package.json', 'assets']) fs.cpSync(path.join(REPO, item), path.join(dir, item), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}

test('--covers refuses to run without --out preview, and writes nothing', () => {
  const dir = makeCopy();
  const r = runBuild(dir, [FIXTURE, '--covers', '--offline', '--cache', `${dir}-c.json`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--covers only works together with --out preview/);
  assert.ok(!fs.existsSync(path.join(dir, 'index.html')));
  assert.ok(!fs.existsSync(path.join(dir, '.agent-fleet')));
  assert.ok(!fs.existsSync(path.join(dir, 'covers')));
  // and --out somewhere else is still refused when covers are asked for
  const bad = runBuild(dir, [FIXTURE, '--covers', '--out', dir, '--cache', `${dir}-c.json`]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--out may only be the preview folder/);
});

test('--covers --out preview: downloads into the private cache outside the repo, copies pictures only into preview/', { skip: !sipsAvailable() }, () => {
  const dir = makeCopy();
  // a small but real JPEG, made with sips from a flat BMP
  const bmp = path.join(dir, 'x.bmp'); const jpg = path.join(dir, 'x.jpg');
  const header = Buffer.alloc(54); header.write('BM'); header.writeUInt32LE(54, 10); header.writeUInt32LE(40, 14); header.writeInt32LE(60, 18); header.writeInt32LE(90, 22); header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28);
  const px = Buffer.alloc(60 * 3 * 90); for (let i = 0; i < px.length; i += 3) { px[i] = (i / 3) % 256; px[i + 1] = 120; px[i + 2] = 60 + ((i / 540) | 0); }
  fs.writeFileSync(bmp, Buffer.concat([header, px]));
  execFileSync('sips', ['-s', 'format', 'jpeg', bmp, '--out', jpg], { stdio: 'ignore' });
  const trap = path.join(dir, 'trap.mjs');
  fs.writeFileSync(trap, `import fs from 'node:fs';
const bytes = fs.readFileSync(${JSON.stringify(jpg)});
globalThis.fetch = async (url) => ({ status: 200, ok: true, url: 'https://covers.openlibrary.org/x.jpg', headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
`);
  const r = spawnSync(process.execPath, ['--import', trap, path.join(dir, 'scripts/build.mjs'), FIXTURE, '--out', path.join(dir, 'preview'), '--cache', `${dir}-c.json`, '--covers'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Covers: \d+ found/);
  const cache = path.join(dir, '.agent-fleet/goodreads/covers');
  assert.equal(fs.statSync(cache).mode & 0o777, 0o700);
  const cached = fs.readdirSync(cache).filter((f) => f.endsWith('.jpg'));
  assert.ok(cached.length > 20);
  for (const f of fs.readdirSync(cache)) assert.equal(fs.statSync(path.join(cache, f)).mode & 0o777, 0o600, f);
  // pictures only inside preview/
  assert.ok(fs.readdirSync(path.join(dir, 'preview/covers')).length === cached.length);
  assert.match(fs.readFileSync(path.join(dir, 'preview/books.html'), 'utf8'), /<img class="cut" src="covers\/\d+\.jpg" alt="" loading="lazy"/);
  assert.ok(!fs.existsSync(path.join(dir, 'covers')));
  assert.ok(!fs.existsSync(path.join(dir, 'index.html')), 'the real site pages are untouched');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['preview', '.agent-fleet'].includes(e.name) && d === dir ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  assert.deepEqual(walk(dir).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f) && !f.endsWith('x.jpg') && !f.includes('/assets/art/') && !f.includes('/assets/projects/')), [], 'no images anywhere outside preview/ and the private cache');
  // a later preview WITHOUT --covers removes the pictures from preview/
  const plain = runBuild(dir, [FIXTURE, '--out', path.join(dir, 'preview'), '--cache', `${dir}-c.json`, '--offline']);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!fs.existsSync(path.join(dir, 'preview/covers')));
  assert.ok(!fs.readFileSync(path.join(dir, 'preview/books.html'), 'utf8').includes('<img'));
});

test('package.json has the covers preview script, preview only', () => {
  const s = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts['preview:covers'];
  assert.match(s, /--out preview/);
  assert.match(s, /--covers/);
  assert.match(s, /--cache "\$HOME\/\.agent-fleet\/goodreads\/spine-colors\.json"/);
});
