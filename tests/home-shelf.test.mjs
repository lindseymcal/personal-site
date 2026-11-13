// The small bookshelf in the study shows real spines with lettering; the project picture; the links.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPages } from '../src/build-site.mjs';
import { homeSpineLayout, spineStyle, HOME_MIN_FONT, HOME_THIN_SPINE } from '../src/spine.mjs';
import { normalizeProjectImage, normalizeProject, normalizeConfig } from '../src/site.mjs';

const csvText = fs.readFileSync(new URL('./fixtures/sample-goodreads.csv', import.meta.url), 'utf8');
const book = (over) => ({ title: 'T', spineTitle: 'A Reasonably Long Title For This', spineAuthor: 'Someone', pages: 300, pubYear: 1900, color: '', favorite: false, ...over });

test('home spines are lettered: titles never go below the 5px hard floor, fit the little spine, and thin ones drop the author', () => {
  for (const tier of [146, 124]) for (const pages of [1, 100, 300, 800, 3000]) for (const spineTitle of ['It', "The Hitchhiker's Guide to the Galaxy", 'x'.repeat(120)]) {
    const b = book({ pages, spineTitle });
    const lay = homeSpineLayout(b, spineStyle(b, undefined), tier);
    assert.ok(lay.fontSize >= 5 && lay.fontSize <= 13, `${lay.fontSize}`);
    assert.ok(lay.height <= tier && lay.height >= Math.round(tier * 0.74));
    assert.ok(lay.width >= 16 && lay.width <= 56);
    assert.equal(lay.showAuthor, lay.width >= HOME_THIN_SPINE);
    assert.ok(lay.lines.length >= 1);
  }
});

test('home shelf markup: real titles and authors, newest reads oldest to newest, phone and desk', () => {
  const html = buildPages({ csvText }).pages['index.html'];
  const room = html.slice(html.indexOf('fit-room'), html.indexOf('wall-fit'));
  const wall = html.slice(html.indexOf('wall-fit'));
  for (const part of [room, wall]) {
    const spines = [...part.matchAll(/<i class="sp hs[^"]*" style="[^"]*"><span class="t">((?:<span>[^<]*<\/span>)+)<\/span>(?:<span class="a">[^<]*<\/span>)?<\/i>/g)];
    assert.ok(spines.length >= 10, `${spines.length} lettered spines`);
  }
  assert.ok(/<span>Middlemarch<\/span>|<span>MIDDLEMARCH<\/span>/i.test(room));
  assert.ok(!/<i class="sp" style="width/.test(html), 'the old blank spines are gone');
});

test('project pictures: only local files under assets/projects/, with alt text', () => {
  assert.deepEqual(normalizeProjectImage({ src: 'assets/projects/a.jpg', alt: 'x', width: 10, height: 5 }), { src: 'assets/projects/a.jpg', alt: 'x', width: 10, height: 5 });
  for (const bad of [null, {}, { src: 'https://x.com/a.jpg', alt: 'x', width: 1, height: 1 }, { src: '../a.jpg', alt: 'x', width: 1, height: 1 }, { src: 'assets/projects/a.jpg', alt: '', width: 1, height: 1 }, { src: 'assets/projects/a.jpg', alt: 'x', width: 0, height: 1 }, { src: 'assets/projects/a.svg', alt: 'x', width: 1, height: 1 }, { src: 'assets/projects/a.jpg" onerror="x', alt: 'x', width: 1, height: 1 }]) assert.equal(normalizeProjectImage(bad), null, JSON.stringify(bad));
  assert.equal(normalizeProject({ title: 'P' }).image, null);
});

test('the agent-fleet page shows its picture (sized, with alt text); the other project keeps its drawing', () => {
  const projectsRaw = JSON.parse(fs.readFileSync(new URL('../content/projects.json', import.meta.url), 'utf8'));
  assert.deepEqual(projectsRaw.map((p) => p.slug), ['agent-fleet', 'painting-app']);
  const { pages } = buildPages({ csvText, projectsRaw });
  const fleet = pages['projects/agent-fleet.html'];
  assert.match(fleet, /<img src="\.\.\/assets\/projects\/agent-fleet\.jpg" width="1000" height="618" alt="[^"]{20,}" decoding="async">/);
  assert.ok(!pages['projects/painting-app.html'].includes('<img'));
  assert.ok(pages['projects/painting-app.html'].includes('href="https://lindseymcal.github.io/painting-intuition/"'));
  const jpg = fs.statSync(new URL('../assets/projects/agent-fleet.jpg', import.meta.url)).size;
  assert.ok(jpg < 180_000, `${jpg} bytes`);
  assert.ok(!('projects/lorem-kit.html' in pages) && !('projects/ipsum-tool.html' in pages));
});

test('the project picture shows no personal names or paths (the sign was changed to a neutral name)', () => {
  // the file is binary, so check the project text that describes it
  const raw = fs.readFileSync(new URL('../content/projects.json', import.meta.url), 'utf8');
  assert.ok(!/\/Users\/|lindsey|zee/i.test(raw.match(/"image"[\s\S]*?\}/)[0]));
});

test('real links are set', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../site.config.json', import.meta.url), 'utf8'));
  assert.equal(cfg.linkedinUrl, 'https://www.linkedin.com/in/lindseymcallister/');
  assert.equal(cfg.substackUrl, 'https://substack.com/@lindseymcal');
  assert.equal(normalizeConfig(cfg).linkedinUrl, cfg.linkedinUrl);
});

test('the résumé paper sits over the bag opening, not at its left side', () => {
  const css = fs.readFileSync(new URL('../assets/home.css', import.meta.url), 'utf8');
  assert.match(css, /\.room \.resume\{left:424px/);
  assert.match(css, /\.wall \.resume\{left:192px/);
});
