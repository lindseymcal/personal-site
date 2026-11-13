// Where builds write: the real build writes ONLY site/ (plus the caches in ~/.agent-fleet), never the repo root;
// the sample refresh writes ONLY the root and never touches site/. SAFETY: temp copies and temp HOME, fixture CSVs only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
after(() => { for (const d of made) for (const x of [d, `${d}-csv.csv`, `${d}-c.json`]) fs.rmSync(x, { recursive: true, force: true }); });
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-')); made.push(dir);
  for (const item of ['scripts', 'src', 'content', 'site.config.json', 'package.json', 'assets', 'tests/fixtures']) fs.cpSync(path.join(REPO, item), path.join(dir, item), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [path.join(dir, 'scripts/build.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } });
const files = (dir, skip = []) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); const rel = path.relative(dir, f); if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue; if (e.isDirectory()) walk(f); else out[rel] = fs.readFileSync(f).toString('base64').length + ':' + fs.statSync(f).size; } };
  walk(dir);
  return out;
};

test('a real build (any CSV that is not the sample) writes only site/ and the caches; the repo root is untouched', () => {
  const dir = makeCopy();
  const csv = `${dir}-csv.csv`; // stands in for her real export: outside the repo
  fs.copyFileSync(path.join(REPO, 'tests/fixtures/sample-goodreads.csv'), csv);
  fs.writeFileSync(path.join(dir, 'index.html'), 'COMMITTED SAMPLE');
  fs.writeFileSync(path.join(dir, 'books.html'), 'COMMITTED SAMPLE BOOKS');
  const before = files(dir, ['site', '.agent-fleet']);
  const r = run(dir, [csv, '--offline', '--cache', `${dir}-c.json`]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Site written to site\//);
  assert.deepEqual(files(dir, ['site', '.agent-fleet']), before, 'something outside site/ changed');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'COMMITTED SAMPLE');
  // site/ is the complete deployable site
  for (const f of ['index.html', 'books.html', 'writing.html', 'projects.html', 'projects/agent-fleet.html', 'assets/site.css', 'assets/fonts.css', 'assets/fonts/andika-400.woff2', 'assets/art/fort-point-fog.jpg', 'assets/projects/agent-fleet.jpg', 'assets/resume.pdf']) {
    assert.ok(fs.existsSync(path.join(dir, 'site', f)), `site/${f}`);
  }
});

test('a real build cannot write the repo root: --root is refused for any CSV but the fake sample, and --out cannot name the root', () => {
  const dir = makeCopy();
  const csv = `${dir}-csv.csv`;
  fs.copyFileSync(path.join(REPO, 'tests/fixtures/sample-goodreads.csv'), csv);
  const a = run(dir, [csv, '--offline', '--root', '--cache', `${dir}-c.json`]);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /only written by the sample refresh/);
  for (const out of ['.', dir, path.join(dir, 'projects')]) {
    const b = run(dir, [csv, '--offline', '--out', out, '--cache', `${dir}-c.json`]);
    assert.equal(b.status, 1, out);
    assert.match(b.stderr, /site folder or the preview folder/);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'index.html')) && !fs.existsSync(path.join(dir, 'site')));
  // the fixture path inside the repo is the one allowed for --root, but not together with --out
  const fx = path.join(dir, 'tests/fixtures/sample-goodreads.csv');
  assert.match(run(dir, [fx, '--offline', '--root', '--out', path.join(dir, 'preview'), '--cache', `${dir}-c.json`]).stderr, /cannot be used together/);
});

test('the sample refresh writes the root from the fake sample and never touches site/', () => {
  const dir = makeCopy();
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site/index.html'), 'ZEE REAL SITE');
  fs.mkdirSync(path.join(dir, 'preview'));
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts;
  assert.match(scripts['refresh:sample'], /--root/);
  assert.match(scripts['refresh:sample'], /tests\/fixtures\/sample-goodreads\.csv/);
  const args = scripts['refresh:sample'].replace('node scripts/build.mjs ', '').split(' ');
  const r = run(dir, args);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Sample pages refreshed in the repo root/);
  assert.equal(fs.readFileSync(path.join(dir, 'site/index.html'), 'utf8'), 'ZEE REAL SITE');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'site')), ['index.html']);
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /Middlemarch|MIDDLEMARCH/i);
});

test('npm run build has no --out and no --root (so it writes site/), and neither it nor build:sample can reach the root', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts;
  assert.ok(!/--root|--out/.test(scripts.build));
  assert.match(scripts.build, /goodreads_library_export\.csv/);
  assert.match(scripts['build:sample'], /--out preview/);
  assert.ok(!/--root/.test(scripts['build:sample']) && !/--root/.test(scripts['preview:covers']));
  assert.match(scripts['serve:site'], /--directory site/);
});

test('.gitignore keeps site/ out of git', () => {
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'site/index.html'], { cwd: REPO }).status, 0);
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'site/assets/resume.pdf'], { cwd: REPO }).status, 0);
});

test('the committed root pages are exactly the sample refresh output (so a stale root fails here)', async () => {
  const { buildPages } = await import('../src/build-site.mjs');
  const { readFeedCache } = await import('../src/feed.mjs');
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  const { pages } = buildPages({
    csvText: read('tests/fixtures/sample-goodreads.csv'),
    extras: JSON.parse(read('content/books-extra.json')),
    colors: JSON.parse(read('tests/fixtures/sample-spine-colors.json')),
    configRaw: JSON.parse(read('site.config.json')),
    projectsRaw: JSON.parse(read('content/projects.json')),
    essays: readFeedCache(JSON.parse(read('content/substack-feed.json')), ['lindseymcal.substack.com']),
  });
  for (const [rel, html] of Object.entries(pages)) assert.equal(read(rel), html, `${rel} is out of date: run npm run refresh:sample`);
});
