// Essays come from the Substack feed: parsing (with hostile fixtures), the fetch safety rules, the cache,
// and how the build uses them. SAFETY: no real network; the CLI runs use a temp copy, a temp HOME and a fake fetch.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFeed, fetchFeed, readFeedCache, feedCacheObject, normalizeEntry, hostAllowed, plainText, FEED_MAX_BYTES } from '../src/feed.mjs';
import { buildPages } from '../src/build-site.mjs';
import { normalizeConfig, groupEssaysByYear } from '../src/site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'tests/fixtures/sample-goodreads.csv');
const xml = fs.readFileSync(path.join(REPO, 'tests/fixtures/substack-feed.xml'), 'utf8');
const csvText = fs.readFileSync(FIXTURE, 'utf8');

const made = [];
after(() => { for (const d of made) for (const x of [d, `${d}-c.json`]) fs.rmSync(x, { recursive: true, force: true }); });
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-')); made.push(dir);
  for (const item of ['scripts', 'src', 'content', 'site.config.json', 'package.json', 'assets']) fs.cpSync(path.join(REPO, item), path.join(dir, item), { recursive: true });
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}

test('parseFeed: keeps good posts, drops other hosts, javascript links, bad dates and empty titles', () => {
  const entries = parseFeed(xml);
  assert.deepEqual(entries.map((e) => e.url), [
    'https://example.substack.com/p/a-quiet-start',
    'https://example.substack.com/p/hostile',
    'https://example.substack.com/p/entities',
    'https://example.substack.com/p/older',
  ]);
  assert.deepEqual(entries.map((e) => e.date), ['2026-10-20', '2026-01-05', '2026-01-02', '2025-12-15']);
  assert.equal(entries[0].summary, 'A short summary with bold & more');
});

test('parseFeed: titles and summaries are plain text only, and the full post HTML is never imported', () => {
  const entries = parseFeed(xml);
  for (const e of entries) {
    assert.ok(!/[<>]/.test(e.title.replace(/&/g, '')) || !/<[a-z\/]/i.test(e.title), e.title);
    assert.ok(!/<[a-z\/]/i.test(e.summary), e.summary);
  }
  assert.equal(entries[1].title, 'alert("title")Hostile title');
  assert.equal(entries[1].summary, 'Summary text');
  assert.match(entries[2].title, /^Entities alert\(3\)/); // entity-encoded tags were decoded, then removed as tags
  assert.ok(!JSON.stringify(entries).includes('FULL POST HTML'));
  assert.ok(!JSON.stringify(entries).includes('body'));
});

test('the writing page shows hostile titles as escaped text and links to the posts in the same tab', () => {
  const html = buildPages({ csvText, essays: parseFeed(xml) }).pages['writing.html'];
  assert.ok(!/<script>alert|<img src=x|onerror=/.test(html.replace(/<script>[\s\S]*?<\/script>/, '')));
  assert.ok(html.includes('<a href="https://example.substack.com/p/a-quiet-start">A quiet start</a>'));
  for (const m of html.matchAll(/<li><a ([^>]*)>/g)) assert.ok(!/target=/.test(m[1]), 'essay links open in the same tab');
  assert.ok(html.includes('2026') && html.includes('2025'));
  assert.ok(html.includes('class="env" href="https://your-name.substack.com/subscribe"'));
  assert.ok(!html.includes('FULL POST HTML'));
  const groups = groupEssaysByYear(parseFeed(xml));
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025]);
});

test('plainText and normalizeEntry guard every field', () => {
  assert.equal(plainText('<![CDATA[a <b>b</b>]]>'), 'a b');
  assert.equal(plainText('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(normalizeEntry({ title: 'T', url: 'https://x.substack.com/p/x', date: '2026-13-01' }), null);
  assert.equal(normalizeEntry({ title: 'T', url: 'http://x.substack.com/p/x', date: '2026-01-01' })?.url, 'http://x.substack.com/p/x'.replace('http:', 'http:'));
  assert.equal(normalizeEntry({ title: 'T', url: 'https://x.com/p/x', date: '2026-01-01' }), null);
  assert.ok(normalizeEntry({ title: 'T', url: 'https://x.com/p/x', date: '2026-01-01' }, ['x.com']));
  assert.equal(normalizeEntry({ title: 'x'.repeat(500), url: 'https://x.substack.com/p/x', date: '2026-01-01' }).title.length, 140);
  assert.equal(normalizeEntry({ title: 'T', url: 'https://x.substack.com/p/x', date: '2026-01-01', summary: 's'.repeat(400) }).summary.length, 160);
});

test('hostAllowed: substack.com and its subdomains, plus an explicitly given custom domain', () => {
  assert.ok(hostAllowed('substack.com') && hostAllowed('lindseymcal.substack.com'));
  assert.ok(!hostAllowed('evilsubstack.com') && !hostAllowed('substack.com.evil.com') && !hostAllowed('example.com'));
  assert.ok(hostAllowed('reading.example.org', ['reading.example.org']));
});

const feedResponse = (over = {}) => ({
  ok: true, status: 200, url: 'https://lindseymcal.substack.com/feed',
  headers: { get: (k) => ({ 'content-type': 'application/rss+xml; charset=utf-8', ...over.headers }[k.toLowerCase()]) },
  arrayBuffer: async () => Buffer.from(over.body ?? xml),
  ...over.res,
});

test('fetchFeed: one request, https on an allowed host only, size and type checked', async () => {
  let calls = 0;
  const ok = await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => { calls++; return feedResponse(); } });
  assert.equal(ok.status, 'ok');
  assert.equal(calls, 1);
  assert.match((await fetchFeed('http://lindseymcal.substack.com/feed', { fetchImpl: async () => feedResponse() })).message, /https/);
  assert.match((await fetchFeed('https://evil.example.com/feed', { fetchImpl: async () => feedResponse() })).message, /https on substack/);
  assert.match((await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => feedResponse({ res: { url: 'https://evil.example.com/feed' } }) })).message, /unexpected host/);
  assert.match((await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => feedResponse({ headers: { 'content-type': 'text/html' } }) })).message, /not a feed/);
  assert.match((await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => feedResponse({ headers: { 'content-length': String(FEED_MAX_BYTES + 1) } }) })).message, /too large/);
  assert.match((await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => feedResponse({ body: 'x'.repeat(FEED_MAX_BYTES + 10) }) })).message, /too large/);
  assert.match((await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => ({ ok: false, status: 503 }) })).message, /503/);
  assert.equal((await fetchFeed('https://lindseymcal.substack.com/feed', { fetchImpl: async () => { throw new Error('offline'); } })).status, 'error');
  // a publication on its own domain works only when that domain is named explicitly
  const own = { fetchImpl: async () => feedResponse({ res: { url: 'https://writing.example.org/feed' } }) };
  assert.equal((await fetchFeed('https://writing.example.org/feed', own)).status, 'error');
  assert.equal((await fetchFeed('https://writing.example.org/feed', { ...own, extraHosts: ['writing.example.org'] })).status, 'ok');
});

test('the saved feed copy is re-checked on every read', () => {
  const entries = parseFeed(xml);
  const cache = feedCacheObject('https://example.substack.com/feed', entries);
  assert.deepEqual(readFeedCache(cache).map((e) => e.url), entries.map((e) => e.url));
  const tampered = { entries: [{ title: '<b>x</b>', url: 'javascript:alert(1)', date: '2026-01-01' }, { title: 'ok', url: 'https://evil.com/x', date: '2026-01-01' }, { title: 'fine', url: 'https://a.substack.com/p/x', date: '2026-01-01' }] };
  assert.deepEqual(readFeedCache(tampered).map((e) => e.title), ['fine']);
  assert.deepEqual(readFeedCache(null), []);
  assert.deepEqual(readFeedCache({ entries: 'nope' }), []);
});

test('config: substackFeedUrl is only a safe web address, and the committed one is her publication', () => {
  assert.equal(normalizeConfig({ substackFeedUrl: 'javascript:x' }).substackFeedUrl, '');
  assert.equal(normalizeConfig({}).substackFeedUrl, '');
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'site.config.json'), 'utf8'));
  assert.equal(cfg.substackFeedUrl, 'https://lindseymcal.substack.com/feed');
  assert.equal(cfg.resumePath, 'assets/resume.pdf');
});

test('the committed essay list is the saved feed copy, and there are no local essay pages or template', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(REPO, 'content/substack-feed.json'), 'utf8'));
  assert.ok(readFeedCache(saved).length >= 1);
  assert.ok(!fs.existsSync(path.join(REPO, 'writing')));
  assert.ok(!fs.existsSync(path.join(REPO, 'docs/essay-template.html')));
  assert.ok(!fs.existsSync(path.join(REPO, 'assets/essay.css')));
});

const run = (dir, args, env = {}, imports = []) => spawnSync(process.execPath, [...imports, path.join(dir, 'scripts/build.mjs'), FIXTURE, '--cache', `${dir}-c.json`, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir, ...env } });
const trap = (dir, body) => { const f = path.join(dir, 'trap.mjs'); fs.writeFileSync(f, `import fs from 'node:fs';\nconst log = (u) => fs.appendFileSync(${JSON.stringify(path.join(dir, 'fetch.log'))}, u + '\\n');\n${body}`); return ['--import', f]; };

test('build: offline uses the saved copy and makes no request', () => {
  const dir = makeCopy();
  const r = run(dir, ['--offline'], {}, trap(dir, "globalThis.fetch = async (u) => { log(u); throw new Error('no'); };"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /essays from the cache \(offline\)/);
  assert.ok(!fs.existsSync(path.join(dir, 'fetch.log')));
  assert.ok(fs.readFileSync(path.join(dir, 'writing.html'), 'utf8').includes('https://lindseymcal.substack.com/p/'));
});

test('build: fetches the feed once, writes the saved copy, and a failed fetch falls back to it with a warning', () => {
  const dir = makeCopy();
  const feed = xml.replace(/example\.substack\.com/g, 'lindseymcal.substack.com');
  const ok = trap(dir, `globalThis.fetch = async (u) => { log(u); return { ok: true, status: 200, url: u, headers: { get: () => 'application/rss+xml' }, arrayBuffer: async () => Buffer.from(${JSON.stringify(feed)}) }; };`);
  const r = run(dir, [], {}, ok);
  assert.equal(r.status, 0, r.stderr);
  const requests = fs.readFileSync(path.join(dir, 'fetch.log'), 'utf8').split('\n').filter((l) => l.includes('/feed'));
  assert.deepEqual(requests, ['https://lindseymcal.substack.com/feed']); // exactly one feed request
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'content/substack-feed.json'), 'utf8'));
  assert.equal(saved.entries.length, 4);
  assert.ok(!JSON.stringify(saved).includes('FULL POST HTML'));
  // now the network fails: the build still works from the saved copy and says so
  const before = fs.readFileSync(path.join(dir, 'content/substack-feed.json'), 'utf8');
  const bad = run(dir, [], {}, trap(dir, "globalThis.fetch = async () => { throw new Error('offline'); };"));
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stderr, /could not read the Substack feed.*using the saved copy/);
  assert.equal(fs.readFileSync(path.join(dir, 'content/substack-feed.json'), 'utf8'), before);
  assert.ok(fs.readFileSync(path.join(dir, 'writing.html'), 'utf8').includes('a-quiet-start'));
});

test('a preview build (--out) may read the feed but never rewrites the saved copy', () => {
  const dir = makeCopy();
  const before = fs.readFileSync(path.join(dir, 'content/substack-feed.json'), 'utf8');
  const feed = xml.replace(/example\.substack\.com/g, 'lindseymcal.substack.com');
  const r = run(dir, ['--out', path.join(dir, 'preview')], {}, trap(dir, `globalThis.fetch = async (u) => ({ ok: true, status: 200, url: u, headers: { get: () => 'application/rss+xml' }, arrayBuffer: async () => Buffer.from(${JSON.stringify(feed)}) });`));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'content/substack-feed.json'), 'utf8'), before);
  assert.ok(fs.readFileSync(path.join(dir, 'preview/writing.html'), 'utf8').includes('a-quiet-start'));
});

test('the published résumé: assets/resume.pdf is the ONE pdf git may take', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'assets/resume.pdf')));
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'assets/resume.pdf'], { cwd: REPO }).status, 1, 'the résumé must not be ignored');
  for (const f of ['resume.pdf', 'assets/other.pdf', 'docs/resume.pdf', 'assets/art/x.pdf']) assert.equal(spawnSync('git', ['check-ignore', '-q', f], { cwd: REPO }).status, 0, `${f} must stay ignored`);
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split('\n');
  assert.ok(ignore.includes('*.pdf') && ignore.includes('!assets/resume.pdf'));
  assert.equal(ignore.filter((l) => /^!.*pdf/.test(l)).length, 1);
});
