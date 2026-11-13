import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeUrl, safeLocalPath, normalizeConfig, DEFAULT_CONFIG, substackSubscribeUrl, normalizeProject, normalizeProjects,
  groupEssaysByYear, splitYearsAcrossPages,
} from '../src/site.mjs';
import { normalizeEntry } from '../src/feed.mjs';

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
  assert.equal(substackSubscribeUrl('https://substack.com/@lindseymcal'), 'https://substack.com/@lindseymcal'); // a profile page is used as it is
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

test('essays group by year, newest first, and split across the two pages', () => {
  const mk = (t, d) => normalizeEntry({ title: t, url: `https://x.substack.com/p/${t}`, date: d });
  const groups = groupEssaysByYear([mk('a', '2024-01-02'), mk('b', '2026-05-01'), mk('c', '2026-09-01'), mk('d', '2025-03-03')]);
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025, 2024]);
  assert.deepEqual(groups[0].essays.map((e) => e.title), ['c', 'b']);
  const { left, right } = splitYearsAcrossPages(groups);
  assert.deepEqual(left.map((g) => g.year), [2026, 2024]);
  assert.deepEqual(right.map((g) => g.year), [2025]);
});
