// Tester's extra tests: real headless Chrome checks (fit the window, phone layout, tab order, reduced motion).
// Skipped automatically when Google Chrome is not installed at the usual macOS path.
// Safety: Chrome gets a throwaway profile and every host name fails to resolve (fonts fall back to system
// fonts; the scene is absolutely positioned at 1280x800, so the geometry is the same). Only file:// pages
// are opened.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { readFeedCache } from '../src/feed.mjs';

const REAL_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// These tests open the site in Chrome. They must not depend on whatever is in the working tree: once Zee
// builds her real 827-book shelf there, pages are huge and slow. So build the fake-sample site into a temp
// folder (pages from the fixture, plus the real assets and essays) and point Chrome at that.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-site-'));
{
  const read = (rel) => fs.readFileSync(path.join(REAL_REPO, rel), 'utf8');
  const essays = readFeedCache(JSON.parse(read('content/substack-feed.json')), ['lindseymcal.substack.com']);
  const { pages } = buildPages({
    csvText: read('tests/fixtures/sample-goodreads.csv'),
    extras: JSON.parse(read('content/books-extra.json')),
    colors: JSON.parse(read('tests/fixtures/sample-spine-colors.json')),
    configRaw: JSON.parse(read('site.config.json')),
    projectsRaw: JSON.parse(read('content/projects.json')),
    essays,
  });
  fs.mkdirSync(path.join(REPO, 'projects'));
  for (const [rel, html] of Object.entries(pages)) fs.writeFileSync(path.join(REPO, rel), html);
  fs.cpSync(path.join(REAL_REPO, 'assets'), path.join(REPO, 'assets'), { recursive: true });
}
after(() => fs.rmSync(REPO, { recursive: true, force: true }));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HAVE_CHROME = fs.existsSync(CHROME);
const opts = { skip: HAVE_CHROME ? false : 'Google Chrome is not installed', timeout: 90_000 };

let proc, profile, port;
async function launch() {
  if (port) return;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-fit-'));
  proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars=false', 'about:blank'], { stdio: 'ignore' });
  const f = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(f); i++) await new Promise((r) => setTimeout(r, 100));
  port = Number(fs.readFileSync(f, 'utf8').split('\n')[0]);
}
after(async () => {
  if (proc) { const done = new Promise((r) => proc.once('exit', r)); proc.kill(); await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]); }
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

// Minimal Chrome DevTools Protocol client for one tab.
async function openTab() {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.splice(0).forEach((w) => w(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  const event = (name) => new Promise((res) => { const w = (m) => (m.method === name ? res(m) : waiters.push(w)); waiters.push(w); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await send('Page.enable');
  const api = {
    async view(width, height, { mobile = false, reduce = false } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
    },
    async open(rel) {
      const loaded = event('Page.loadEventFired');
      await send('Page.navigate', { url: pathToFileURL(path.join(REPO, rel)).href });
      await loaded;
      await sleep(150);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    },
    async tab() {
      for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await sleep(50);
    },
    sleep,
    close: () => { ws.close(); },
  };
  return api;
}

// what the page looks like at this size
const MEASURE = `(() => {
  const de = document.documentElement, b = document.body;
  const cs = (e) => getComputedStyle(e);
  const stage = document.querySelector('.fit:not([style*="none"]) .stage, .stage');
  const visibleStage = [...document.querySelectorAll('.stage')].find((e) => e.getClientRects().length);
  const r = visibleStage ? visibleStage.getBoundingClientRect() : null;
  return {
    w: innerWidth, h: innerHeight,
    scrollW: de.scrollWidth, scrollH: de.scrollHeight, clientW: de.clientWidth, clientH: de.clientHeight,
    bodyScrollW: b.scrollWidth, bodyScrollH: b.scrollHeight,
    overflowY: cs(de).overflowY, overflowX: cs(de).overflowX, bodyOverflowY: cs(b).overflowY,
    canScrollY: de.scrollHeight > de.clientHeight + 1 && cs(de).overflowY !== 'hidden' && cs(b).overflowY !== 'hidden',
    canScrollX: de.scrollWidth > de.clientWidth + 1 && cs(de).overflowX !== 'hidden' && cs(b).overflowX !== 'hidden',
    stage: r && { l: r.left, t: r.top, r: r.right, b: r.bottom },
    scale: cs(de).getPropertyValue('--s'),
    fitRoom: document.querySelector('.fit-room') ? cs(document.querySelector('.fit-room')).display : null,
    wall: document.querySelector('.wall-fit') ? cs(document.querySelector('.wall-fit')).display : null,
  };
})()`;

const DESKTOP = [[1440, 900], [1280, 720], [1024, 768], [1920, 1080], [1366, 768], [800, 600]];

test('desktop: the study, writing and projects scenes fit the window with no scrollbars at common sizes', opts, async () => {
  await launch();
  const tab = await openTab();
  const bad = [];
  for (const page of ['index.html', 'writing.html', 'projects.html']) {
    for (const [w, h] of DESKTOP) {
      await tab.view(w, h);
      await tab.open(page);
      const m = await tab.eval(MEASURE);
      const tol = 1.5;
      if (m.canScrollX || m.canScrollY) bad.push(`${page} ${w}x${h}: page can scroll (${JSON.stringify(m)})`);
      if (!m.stage) { bad.push(`${page} ${w}x${h}: no visible stage`); continue; }
      if (m.stage.l < -tol || m.stage.t < -tol || m.stage.r > w + tol || m.stage.b > h + tol) bad.push(`${page} ${w}x${h}: scene sticks out of the window ${JSON.stringify(m.stage)}`);
      // and it should use the window well: touching the width or the height
      if (m.stage.r - m.stage.l < w - 2 && m.stage.b - m.stage.t < h - 2) bad.push(`${page} ${w}x${h}: scene is smaller than needed ${JSON.stringify(m.stage)}`);
      if (m.fitRoom !== null && (m.fitRoom === 'none' || m.wall !== 'none')) bad.push(`${page} ${w}x${h}: wrong layout shown (room ${m.fitRoom}, wall ${m.wall})`);
    }
  }
  tab.close();
  assert.deepEqual(bad, []);
});

test('desktop: every object on the study is fully inside the window at each size', opts, async () => {
  await launch();
  const tab = await openTab();
  const bad = [];
  for (const [w, h] of DESKTOP) {
    await tab.view(w, h);
    await tab.open('index.html');
    const objs = await tab.eval(`[...document.querySelectorAll('.fit-room .obj, .fit-room .sign')].map((e) => { const r = e.getBoundingClientRect(); return { n: e.getAttribute('aria-label') || e.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom }; })`);
    assert.ok(objs.length >= 8, 'expected the 7 objects and the name');
    for (const o of objs) if (o.l < -2 || o.t < -2 || o.r > w + 2 || o.b > h + 2) bad.push(`${w}x${h}: ${o.n} at ${Math.round(o.l)},${Math.round(o.t)}-${Math.round(o.r)},${Math.round(o.b)}`);
  }
  tab.close();
  assert.deepEqual(bad, []);
});

test('books page: fits the width at every size (never a sideways scroll); a short shelf also fits the height', opts, async () => {
  await launch();
  const tab = await openTab();
  const bad = [];
  for (const [w, h] of DESKTOP) {
    await tab.view(w, h);
    await tab.open('books.html');
    const m = await tab.eval(MEASURE);
    if (m.canScrollX) bad.push(`${w}x${h}: sideways scroll`);
    if (m.stage && (m.stage.l < -1.5 || m.stage.r > w + 1.5)) bad.push(`${w}x${h}: scene wider than window ${JSON.stringify(m.stage)}`);
    const tall = await tab.eval(`document.documentElement.classList.contains('tall')`);
    if (!tall && m.canScrollY) bad.push(`${w}x${h}: non-tall shelf scrolls`);
  }
  tab.close();
  assert.deepEqual(bad, []);
});

test('phone 390x844: the phone layout takes over, nothing scrolls sideways, labels stay visible', opts, async () => {
  await launch();
  const tab = await openTab();
  await tab.view(390, 844, { mobile: true });
  const problems = [];
  for (const page of ['index.html', 'books.html', 'writing.html', 'projects.html', 'projects/agent-fleet.html']) {
    await tab.open(page);
    const m = await tab.eval(MEASURE);
    if (m.canScrollX || m.bodyScrollW > 391 || m.scrollW > 391) problems.push(`${page}: sideways overflow (scrollW ${m.scrollW}, body ${m.bodyScrollW})`);
    if (page === 'index.html') {
      if (m.fitRoom !== 'none' || m.wall === 'none') problems.push(`index: phone layout not active (room ${m.fitRoom}, wall ${m.wall})`);
      const tags = await tab.eval(`[...document.querySelectorAll('.wall-fit .tag')].map((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { t: e.textContent, op: +c.opacity, vis: c.visibility, display: c.display, r: r.right, l: r.left }; })`);
      assert.ok(tags.length >= 6, 'phone labels missing');
      for (const t of tags) if (t.op < 0.99 || t.vis !== 'visible' || t.display === 'none' || t.r > 392 || t.l < -2) problems.push(`phone label "${t.t}" not visible/inside: ${JSON.stringify(t)}`);
      const names = await tab.eval(`[...document.querySelectorAll('.wall-fit .obj')].map((e) => e.getAttribute('aria-label'))`);
      assert.ok(names.every(Boolean));
    }
  }
  tab.close();
  assert.deepEqual(problems, []);
});

test('the breakpoint: 701px is the desktop scene, 700px is the phone layout', opts, async () => {
  await launch();
  const tab = await openTab();
  await tab.view(701, 800); await tab.open('index.html');
  const a = await tab.eval(MEASURE);
  await tab.view(700, 800, { mobile: false }); await tab.open('index.html');
  const b = await tab.eval(MEASURE);
  tab.close();
  assert.equal(a.fitRoom, 'block'); assert.equal(a.wall, 'none');
  assert.equal(b.fitRoom, 'none'); assert.notEqual(b.wall, 'none');
});

test('real Tab key: the first stop on every inner page is "Back to the study"; on the study the first stop is a visible object', opts, async () => {
  await launch();
  const tab = await openTab();
  const bad = [];
  const first = `(() => { const e = document.activeElement; return e && e !== document.body ? { label: e.getAttribute('aria-label'), href: e.getAttribute('href') } : null; })()`;
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    await tab.view(w, h, { mobile });
    for (const page of ['books.html', 'writing.html', 'projects.html', 'projects/agent-fleet.html']) {
      await tab.open(page);
      await tab.tab();
      const f = await tab.eval(first);
      if (f?.label !== 'Back to the study') bad.push(`${page} @${w}: first Tab stop is ${JSON.stringify(f)}`);
    }
    await tab.open('index.html');
    const order = [];
    for (let i = 0; i < 9; i++) { await tab.tab(); order.push(await tab.eval(first)); }
    const labels = order.map((o) => o?.label);
    // each of the seven objects exactly once in the first seven stops (no hidden layout doubling the order)
    const uniq = new Set(labels.slice(0, 7));
    if (uniq.size !== 7) bad.push(`study @${w}: first 7 tab stops are not 7 different objects: ${JSON.stringify(labels)}`);
    if (labels.includes('Back to the study')) bad.push(`study @${w}: has a back window`);
  }
  tab.close();
  assert.deepEqual(bad, []);
});

test('study labels: hidden at rest on desktop, shown on keyboard focus; reduced-motion switches the animations off', opts, async () => {
  await launch();
  const tab = await openTab();
  await tab.view(1440, 900);
  await tab.open('index.html');
  const rest = await tab.eval(`[...document.querySelectorAll('.fit-room .label')].map((e) => +getComputedStyle(e).opacity)`);
  assert.ok(rest.length >= 7 && rest.every((o) => o === 0), `labels visible at rest: ${rest}`);
  const bad = [];
  const objs = ['painting', 'postcard', 'shelf', 'desk', 'peg', 'resume', 'linkedin'] // visual order: top row first;
  const animatedWhenAllowed = [];
  for (const reduce of [false, true]) {
    await tab.view(1440, 900, { reduce });
    await tab.open('index.html');
    // press the real Tab key through the seven objects, in order
    for (let i = 0; i < objs.length; i++) {
      await tab.tab();
      await tab.sleep(250);
      const r = await tab.eval(`(() => {
        const el = document.activeElement;
        const label = el.querySelector && el.querySelector('.label');
        const anims = document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes && a.effect.getKeyframes().length > 2).length;
        return { cls: el.className, label: label ? +getComputedStyle(label).opacity : -1, anims };
      })()`);
      const o = objs[i];
      if (!r.cls.includes(o)) { bad.push(`tab stop ${i + 1} is "${r.cls}", expected the ${o}`); continue; }
      if (r.label < 0.9) bad.push(`${o} (reduce=${reduce}): label not shown on keyboard focus (opacity ${r.label})`);
      if (reduce && r.anims > 0) bad.push(`${o}: ${r.anims} animation(s) still run with prefers-reduced-motion: reduce`);
      if (!reduce) animatedWhenAllowed.push(...(r.anims > 0 ? [o] : []));
    }
  }
  tab.close();
  assert.deepEqual(bad, []);
  // control: the detector does see animations when motion is allowed, so the reduce=true result means something
  assert.ok(animatedWhenAllowed.length >= 3, `expected focus animations when motion is allowed; saw them on: ${animatedWhenAllowed}`);
});
