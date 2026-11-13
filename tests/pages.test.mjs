// Tester's extra tests: structure and accessibility rules of the generated pages (the committed ones
// plus a fresh build), and the CSS rules that cannot be seen in a unit test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { parseEssay } from '../src/site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// every page the site ships: the generated ones and the hand-written essays
const GENERATED = ['index.html', 'books.html', 'writing.html', 'projects.html', ...fs.readdirSync(path.join(REPO, 'projects')).filter((f) => f.endsWith('.html')).map((f) => `projects/${f}`)];
const ESSAYS = fs.readdirSync(path.join(REPO, 'writing')).filter((f) => f.endsWith('.html')).map((f) => `writing/${f}`);
const ALL = [...GENERATED, ...ESSAYS];

const body = (html) => html.slice(html.indexOf('<body'));
const anchors = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], inner: m[2], label: m[1].match(/aria-label="([^"]*)"/)?.[1], href: m[1].match(/href="([^"]*)"/)?.[1] }));

test('there is a fresh-build copy of the committed pages: generated pages are not stale vs the sample CSV', () => {
  const cfg = JSON.parse(read('site.config.json'));
  const essays = ESSAYS.filter((f) => !path.basename(f).startsWith('_')).map((f) => parseEssay(read(f), path.basename(f)));
  const { pages } = buildPages({
    csvText: read('tests/fixtures/sample-goodreads.csv'),
    extras: JSON.parse(read('content/books-extra.json')),
    colors: JSON.parse(read('content/spine-colors.json')),
    configRaw: cfg,
    projectsRaw: JSON.parse(read('content/projects.json')),
    essays,
  });
  for (const [rel, html] of Object.entries(pages)) assert.equal(read(rel), html, `${rel} is out of date: re-run npm run build:sample`);
  assert.deepEqual(GENERATED.sort(), Object.keys(pages).sort());
});

test('every page: lang, viewport, title, one h1, and a main landmark', () => {
  for (const rel of ALL) {
    const html = read(rel);
    assert.match(html, /<html lang="en"/, rel);
    assert.match(html, /<meta name="viewport"/, rel);
    assert.match(html, /<title>[^<]+<\/title>/, rel);
    // the study has two h1s on purpose: the desk and phone layouts, one of which is display:none
    assert.equal((body(html).match(/<h1\b/g) || []).length, rel === 'index.html' ? 2 : 1, `${rel}: h1 count`);
    assert.ok(/<main\b/.test(html), `${rel}: main`);
  }
});

test('every inner page: the brass "Back to the study" window is the FIRST link in tab order', () => {
  for (const rel of ALL.filter((r) => r !== 'index.html' && !path.basename(r).startsWith('_'))) {
    const html = read(rel);
    const first = anchors(body(html))[0];
    assert.equal(first.label, 'Back to the study', `${rel}: first link is ${first.href}`);
    assert.match(first.attrs, /class="home"/, rel);
    assert.equal(first.href, rel.includes('/') ? '../index.html' : 'index.html', rel);
    // and nothing focusable appears before it in the source
    const before = body(html).slice(0, body(html).indexOf(first.attrs));
    assert.ok(!/<(button|input|select|textarea)\b|tabindex=|<a\b/.test(before.replace(/<a\b[^>]*$/, '')), `${rel}: something focusable before the back window`);
  }
});

test('the study (home) is not the first thing: it has no back window, and tabindex is never positive anywhere', () => {
  assert.ok(!read('index.html').includes('Back to the study'));
  for (const rel of ALL) assert.ok(!/tabindex="[1-9]/.test(read(rel)), rel);
});

test('no top nav, header or bottom banner on any page; the only <nav> is the two-object "Way back" on deep pages', () => {
  for (const rel of ALL) {
    const b = body(read(rel));
    assert.ok(!/<header\b|role="banner"|role="navigation"|role="contentinfo"/.test(b), `${rel}: header/banner`);
    assert.ok(!/<footer\b/.test(b.replace(/<footer class="end">[\s\S]*?<\/footer>/, '')), `${rel}: site footer`);
    const navs = b.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/g) || [];
    for (const nav of navs) {
      assert.match(nav, /aria-label="Way back"/, rel);
      assert.equal(anchors(nav).length, 2, `${rel}: way-back nav should hold exactly two objects`);
    }
    if (!/^(projects|writing)\//.test(rel)) assert.equal(navs.length, 0, `${rel}: unexpected nav`);
    else assert.equal(navs.length, 1, rel);
  }
});

test('each section has exactly one route in from the study (per layout: desk and phone)', () => {
  const home = read('index.html');
  const desk = home.slice(home.indexOf('class="fit fit-room"'), home.indexOf('class="wall-fit"'));
  const phone = home.slice(home.indexOf('class="wall-fit"'));
  for (const [name, part] of [['desk', desk], ['phone', phone]]) {
    const hrefs = anchors(part).map((a) => a.href);
    for (const target of ['books.html', 'writing.html', 'projects.html', 'resume.pdf']) {
      assert.equal(hrefs.filter((h) => h === target).length, 1, `${name}: ${target}`);
    }
    assert.equal(hrefs.filter((h) => /^https:\/\/(art\.|www\.instagram|www\.linkedin)/.test(h)).length, 3, `${name}: art, instagram, linkedin`);
    assert.equal(hrefs.length, 7, `${name}: unexpected extra links: ${hrefs}`);
  }
  // inner pages do not link sideways to other sections (only home, plus the deep pages' one extra object)
  const books = anchors(body(read('books.html'))).map((a) => a.href).filter((h) => !h.startsWith('#'));
  assert.deepEqual(books, ['index.html']);
  const writing = anchors(body(read('writing.html'))).map((a) => a.href);
  assert.ok(!writing.includes('books.html') && !writing.includes('projects.html'));
  const projects = anchors(body(read('projects.html'))).map((a) => a.href);
  assert.ok(!projects.includes('books.html') && !projects.includes('writing.html'));
});

test('project pages: no extra résumé link, way back is the window then the tin', () => {
  for (const rel of GENERATED.filter((r) => r.startsWith('projects/'))) {
    const html = read(rel);
    assert.ok(!/resume/i.test(body(html).replace(/<style[\s\S]*?<\/style>/g, '')), `${rel}: mentions résumé`);
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
    assert.deepEqual(anchors(nav).map((a) => a.label), ['Back to the study', 'All projects']);
  }
  for (const rel of ESSAYS.filter((r) => !path.basename(r).startsWith('_'))) {
    const nav = read(rel).match(/<nav[\s\S]*?<\/nav>/)[0];
    assert.deepEqual(anchors(nav).map((a) => a.label), ['Back to the study', 'All writing']);
  }
});

test('every link has an accessible name; every .obj has an aria-label', () => {
  for (const rel of ALL) {
    const html = read(rel);
    for (const a of anchors(body(html))) {
      const text = a.inner.replace(/<[^>]*>/g, '').trim();
      assert.ok(a.label?.trim() || text, `${rel}: link to ${a.href} has no name`);
    }
    for (const m of body(html).matchAll(/<a\b[^>]*class="[^"]*\bobj\b[^"]*"[^>]*>/g)) {
      assert.match(m[0], /aria-label="[^"]+"/, `${rel}: ${m[0]}`);
    }
  }
});

test('the labels (visible hover text) are hidden from screen readers so each object is announced once', () => {
  const home = read('index.html');
  for (const m of home.matchAll(/<span class="(label|tag)"[^>]*>/g)) assert.match(m[0], /aria-hidden="true"/);
});

test('links that open a new tab say so, and carry rel=noopener', () => {
  for (const rel of ALL) {
    for (const a of anchors(body(read(rel)))) {
      if (!/target="_blank"/.test(a.attrs)) continue;
      assert.match(a.attrs, /rel="noopener"/, `${rel}: ${a.href}`);
      assert.ok(/opens in a new tab/i.test(a.label ?? '') || /opens in a new tab/i.test(a.inner), `${rel}: ${a.href} does not announce a new tab`);
    }
    for (const a of anchors(body(read(rel)))) if (/^https?:/.test(a.href)) assert.match(a.attrs, /target="_blank"/, `${rel}: external ${a.href} opens in the same tab`);
  }
});

test('internal links resolve to files that exist (résumé.pdf is the one allowed gap until Zee adds it)', () => {
  const missing = [];
  for (const rel of ALL) {
    const html = read(rel);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const a of anchors(body(html))) {
      if (!a.href || /^(https?:|mailto:)/.test(a.href)) continue;
      if (a.href.startsWith('#')) { if (a.href.length > 1 && !ids.has(a.href.slice(1))) missing.push(`${rel} -> ${a.href}`); continue; }
      const file = path.join(REPO, path.dirname(rel), a.href.split('#')[0]);
      if (!fs.existsSync(file)) missing.push(`${rel} -> ${a.href}`);
    }
    for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) {
      if (/^https:\/\/fonts\./.test(m[1])) continue;
      if (!fs.existsSync(path.join(REPO, path.dirname(rel), m[1]))) missing.push(`${rel} -> stylesheet ${m[1]}`);
    }
  }
  const unexpected = [...new Set(missing)].filter((m) => !m.endsWith('-> resume.pdf'));
  assert.deepEqual(unexpected, []);
});

test('ids are unique on every page', () => {
  for (const rel of ALL) {
    const ids = [...read(rel).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, rel);
  }
});

test('no external requests except Google Fonts: no images, scripts, iframes, imports, Open Library, or remote CSS urls', () => {
  const css = fs.readdirSync(path.join(REPO, 'assets')).map((f) => `assets/${f}`);
  for (const rel of [...ALL, ...css]) {
    const text = read(rel);
    assert.ok(!/openlibrary|covers\./i.test(text), `${rel}: mentions Open Library`);
    assert.ok(!/<img\b|<iframe\b|<embed\b|<object\b|<video\b|<audio\b|<source\b|<script[^>]*\ssrc=|<form\b/i.test(text), `${rel}: loads a resource tag`);
    assert.ok(!/@import|url\(\s*["']?(https?:)?\/\//i.test(text), `${rel}: remote @import/url()`);
    assert.ok(!/(?:src|srcset|poster|data)\s*=\s*["']?https?:/i.test(text), `${rel}: remote src`);
    for (const m of text.matchAll(/<link\b[^>]*>/g)) {
      const href = m[0].match(/href="([^"]*)"/)?.[1] ?? '';
      if (/^https?:/.test(href)) assert.match(href, /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/, `${rel}: ${href}`);
    }
    for (const m of text.matchAll(/<script\b[^>]*>/g)) assert.equal(m[0], '<script>', `${rel}: script tag with attributes`);
  }
});

test('scripts: only the one tiny inline fit script on scene pages, none elsewhere; it touches no network', () => {
  for (const rel of ALL) {
    const scripts = [...read(rel).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length <= 1, rel);
    for (const s of scripts) assert.ok(!/fetch|XMLHttpRequest|WebSocket|sendBeacon|import\(|eval|document\.write|localStorage|cookie/.test(s), rel);
  }
  assert.equal((read('projects/agent-fleet.html').match(/<script/g) || []).length, 0);
});

test('reduced motion: every animation (and every transform transition) sits inside prefers-reduced-motion: no-preference', () => {
  const offenders = [];
  for (const f of fs.readdirSync(path.join(REPO, 'assets'))) {
    const t = read(`assets/${f}`).replace(/\/\*[\s\S]*?\*\//g, '');
    const stack = [];
    let cur = '';
    let line = 1;
    const check = () => {
      for (const d of cur.split(';')) {
        const m = d.match(/^\s*(animation[a-z-]*|transition[a-z-]*)\s*:\s*(.*)$/s);
        if (!m) continue;
        const guarded = stack.some((s) => /prefers-reduced-motion:\s*no-preference/.test(s)) || stack.some((s) => /@keyframes/.test(s));
        // opacity/filter fades are not motion; anything that moves (transform, translate, rotate, scale, all, margin, top/left) is
        const moves = m[1].startsWith('animation') || /transform|translate|rotate|scale|\ball\b|margin|top|left|width|height/.test(m[2]);
        if (moves && !guarded) offenders.push(`${f}:${line} ${d.trim()}`);
      }
    };
    for (const c of t) {
      if (c === '\n') line++;
      if (c === '{') { stack.push(cur.trim()); cur = ''; }
      else if (c === '}') { check(); stack.pop(); cur = ''; }
      else cur += c;
    }
  }
  assert.deepEqual(offenders, []);
});

test('reduced motion: every @keyframes is only reachable from a guarded rule', () => {
  for (const f of fs.readdirSync(path.join(REPO, 'assets'))) {
    const t = read(`assets/${f}`);
    const names = [...t.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    // the guarded block runs from the media query to the matching close brace
    const guardedParts = [];
    for (const m of t.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/g)) {
      let depth = 1, i = m.index + m[0].length;
      while (depth && i < t.length) { if (t[i] === '{') depth++; else if (t[i] === '}') depth--; i++; }
      guardedParts.push(t.slice(m.index, i));
    }
    const guarded = guardedParts.join('\n');
    for (const n of names) assert.ok(new RegExp(`@keyframes\\s+${n}\\b`).test(guarded), `${f}: @keyframes ${n} is outside the no-preference block`);
  }
});

test('the home page hides the unused layout with CSS at the 700px breakpoint (so tab order is not doubled)', () => {
  const css = read('assets/home.css');
  assert.match(css, /@media \(max-width:700px\)\{\.fit-room\{display:none\}\}/);
  assert.match(css, /@media \(min-width:701px\)\{\.wall-fit\{display:none\}\}/);
});

test('every object on the study has a hover/focus motion: each focusable object appears in a no-preference focus rule', () => {
  const css = read('assets/home.css');
  const block = css.slice(css.indexOf('prefers-reduced-motion: no-preference'));
  for (const obj of ['shelf', 'desk', 'painting', 'postcard', 'peg', 'resume', 'linkedin']) {
    assert.match(block, new RegExp(`\\.room \\.${obj}[^{]*:(focus-visible|hover)`), obj);
  }
});

test('every focusable thing has a visible focus style (global :focus-visible outline is not removed)', () => {
  assert.match(read('assets/site.css'), /:focus-visible\{outline:3px solid/);
  for (const f of fs.readdirSync(path.join(REPO, 'assets'))) assert.ok(!/outline\s*:\s*(none|0)\b/.test(read(`assets/${f}`).replace(/:focus-visible\{outline:3px[^}]*\}/, '')), `${f}: removes outlines`);
});

test('the books page review letters are keyboard-reachable (scrollable region has tabindex)', () => {
  const html = read('books.html');
  for (const m of html.matchAll(/<article class="letter"[^>]*>/g)) assert.match(m[0], /tabindex="0"/);
});
