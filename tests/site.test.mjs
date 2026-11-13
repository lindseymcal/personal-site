import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeUrl, safeLocalPath, normalizeConfig, DEFAULT_CONFIG, substackSubscribeUrl, normalizeProject, normalizeProjects,
  parseMetaTags, parseEssay, groupEssaysByYear, splitYearsAcrossPages,
} from '../src/site.mjs';

test('safeUrl allows only http(s) links', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,hi', 'x'), 'x');
  assert.equal(safeUrl('https://x.com/"onmouseover="alert(1)'), '#');
  assert.equal(safeUrl('//evil.com'), '#');
  assert.equal(safeUrl(undefined, ''), '');
});

test('safeLocalPath allows a plain file name only', () => {
  assert.equal(safeLocalPath('files/cv.pdf'), 'files/cv.pdf');
  assert.equal(safeLocalPath('../secret.pdf'), 'resume.pdf');
  assert.equal(safeLocalPath('/etc/passwd'), 'resume.pdf');
  assert.equal(safeLocalPath('javascript:alert(1)'), 'resume.pdf');
  assert.equal(safeLocalPath(''), 'resume.pdf');
});

test('normalizeConfig fills defaults and rejects bad urls', () => {
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
  const c = normalizeConfig({ name: '  Zee  ', artSiteUrl: 'https://zee.art', linkedinUrl: 'javascript:x' });
  assert.equal(c.name, 'Zee');
  assert.equal(c.artSiteUrl, 'https://zee.art');
  assert.equal(c.linkedinUrl, DEFAULT_CONFIG.linkedinUrl);
});

test('substack subscribe link', () => {
  assert.equal(substackSubscribeUrl('https://zee.substack.com/'), 'https://zee.substack.com/subscribe');
  assert.equal(substackSubscribeUrl('nope'), '#');
});

test('normalizeProject trims, slugs, and drops bad links', () => {
  const p = normalizeProject({
    title: ' Painting app ', links: [{ label: 'Live', url: 'https://x.com' }, { label: 'Bad', url: 'javascript:1' }, { url: 'https://y.com' }],
    built: ['a', '', 'b'],
  });
  assert.equal(p.slug, 'painting-app');
  assert.equal(p.title, 'Painting app');
  assert.deepEqual(p.links, [{ label: 'Live', url: 'https://x.com' }]);
  assert.deepEqual(p.built, ['a', 'b']);
});

test('normalizeProjects drops untitled and duplicate projects', () => {
  const out = normalizeProjects([{ title: 'A' }, { title: '' }, { title: 'A' }, { title: 'B', slug: 'a' }, { title: 'C' }]);
  assert.deepEqual(out.map((p) => p.slug), ['a', 'c']);
  assert.deepEqual(normalizeProjects('nope'), []);
});

const essayHtml = `<!doctype html><head>
<meta name="essay-title" content="On &amp; off">
<meta content="2026-10-30" name="essay-date">
<meta name='essay-summary' content='A summary'>
<meta name="essay-substack" content="https://z.substack.com/p/x">
</head>`;

test('parseMetaTags reads either attribute order and decodes entities', () => {
  const m = parseMetaTags(essayHtml);
  assert.equal(m['essay-title'], 'On & off');
  assert.equal(m['essay-date'], '2026-10-30');
  assert.equal(m['essay-summary'], 'A summary');
});

test('parseEssay', () => {
  const e = parseEssay(essayHtml, 'on-and-off.html');
  assert.equal(e.slug, 'on-and-off');
  assert.deepEqual([e.year, e.month, e.day], [2026, 10, 30]);
  assert.equal(e.substackUrl, 'https://z.substack.com/p/x');
});

test('parseEssay reports what is missing, naming the file', () => {
  assert.match(parseEssay('<head></head>', 'a.html').error, /a\.html.*essay-title/);
  assert.match(parseEssay('<meta name="essay-title" content="T"><meta name="essay-date" content="Oct 3">', 'b.html').error, /b\.html.*essay-date/);
});

test('essays group by year, newest first, and split across the two pages', () => {
  const mk = (t, d) => parseEssay(`<meta name="essay-title" content="${t}"><meta name="essay-date" content="${d}">`, `${t}.html`);
  const groups = groupEssaysByYear([mk('a', '2024-01-02'), mk('b', '2026-05-01'), mk('c', '2026-09-01'), mk('d', '2025-03-03')]);
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025, 2024]);
  assert.deepEqual(groups[0].essays.map((e) => e.title), ['c', 'b']);
  const { left, right } = splitYearsAcrossPages(groups);
  assert.deepEqual(left.map((g) => g.year), [2026, 2024]);
  assert.deepEqual(right.map((g) => g.year), [2025]);
});
