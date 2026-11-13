// Tester's extra tests: hostile text must never become markup, a URL scheme, or CSS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewToParagraphs, reviewToHtml, escapeHtml, mergeExtra, rowToBook } from '../src/books.mjs';
import { normalizeConfig, normalizeProject, safeUrl, safeLocalPath, parseEssay, parseMetaTags } from '../src/site.mjs';
import { buildPages } from '../src/build-site.mjs';
import { spineStyle } from '../src/spine.mjs';
import { DEFAULT_CONFIG as DEFAULT } from '../src/site.mjs';

const HEADER = 'Book Id,Title,Author,Author l-f,ISBN,ISBN13,My Rating,Number of Pages,Original Publication Year,Year Published,Date Read,Date Added,Exclusive Shelf,My Review';
const q = (v) => `"${String(v).replaceAll('"', '""')}"`;
const csvOf = (o) => `${HEADER}\n${[o.id ?? '1', q(o.title ?? 'T'), q(o.author ?? 'A'), q(o.lf ?? 'A, A'), '', '', '3', '100', '1900', '1900', '2024/01/01', '2024/01/01', 'read', q(o.review ?? '')].join(',')}\n`;
const pagesFor = (o, extra = {}) => buildPages({ csvText: csvOf(o), projectsRaw: [{ title: 'P' }], ...extra }).pages;

// Tokenize real tags (respecting quoted attribute values) and report anything we did not write ourselves:
// a tag name outside the templates' set, an on* attribute, or a javascript: URL. Escaped text such as
// "&lt;img onerror=" is NOT markup and is correctly ignored.
const OK_TAGS = new Set(['html', 'head', 'meta', 'title', 'link', 'script', 'style', 'body', 'div', 'main', 'section', 'article', 'a', 'i', 'b', 'span', 'p', 'h1', 'h2', 'ul', 'li', 'time', 'small', 'nav', 'dl', 'dt', 'dd', 'blockquote', 'footer']);
export function tagsIn(html) {
  const out = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = [...m[2].matchAll(/([^\s=\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((x) => ({ name: x[1].toLowerCase(), value: x[2] ?? x[3] ?? x[4] ?? '' }));
    out.push({ name: m[1].toLowerCase(), attrs });
  }
  return out;
}
function foreignMarkup(html) {
  const noOwn = html.replace(/<script>[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const t of tagsIn(noOwn)) {
    if (!OK_TAGS.has(t.name)) return [`<${t.name}>`];
    for (const a of t.attrs) {
      if (/^on/.test(a.name)) return [`${t.name} ${a.name}`];
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value)) return [`${t.name} ${a.name}=${a.value}`];
    }
  }
  return null;
}

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '"><script>alert(1)</script>',
  "' onmouseover='alert(1)",
  '" autofocus onfocus="alert(1)',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '&amp;lt;script&amp;gt;alert(1)',
  '&#x3c;img src=x onerror=alert(1)&#x3e;',
  '<a href="javascript:alert(1)">click</a>',
  'javascript:alert(1)',
  '</style><script>alert(1)</script>',
  '</title><script>alert(1)</script>',
  '<!-- --><script>alert(1)</script>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
];

test('hostile text in title, author and review never becomes markup on any page', () => {
  for (const h of HOSTILE) {
    for (const field of ['title', 'author', 'review']) {
      const pages = pagesFor({ [field]: h });
      for (const [name, html] of Object.entries(pages)) {
        const hit = foreignMarkup(html);
        assert.equal(hit, null, `${field}=${h} on ${name} produced ${hit && hit[0]}`);
      }
    }
  }
});

test('pre-encoded entities are shown as text, never decoded into live tags', () => {
  const html = reviewToHtml('&lt;script&gt;alert(1)&lt;/script&gt; and &amp;lt;b&amp;gt;');
  // one decoding pass only: "&amp;lt;b&amp;gt;" shows as the literal text "&lt;b&gt;"
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt; and &amp;lt;b&amp;gt;</p>');
  assert.ok(!html.includes('<script'));
});

test('review line breaks: <br>, <BR />, <br/>, <Br  /> all split paragraphs; real newlines too', () => {
  assert.deepEqual(reviewToParagraphs('a<br>b<BR />c<br/>d<Br  />e\nf\r\ng'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(reviewToParagraphs('<p>one</p><p>two</p>'), ['one', 'two']);
  assert.deepEqual(reviewToParagraphs('<br><br><br>'), []);
  assert.deepEqual(reviewToParagraphs(''), []);
  assert.deepEqual(reviewToParagraphs(undefined), []);
});

test('review: formatting tags are dropped but the words stay; plain "<" and ">" in prose stay as text', () => {
  assert.deepEqual(reviewToParagraphs('I <i>loved</i> it, 2 < 3 and 5 > 4'), ['I loved it, 2 < 3 and 5 > 4']);
  assert.equal(reviewToHtml('2 < 3'), '<p>2 &lt; 3</p>');
});

test('escapeHtml covers & < > " \' and nullish', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(5), '5');
});

test('aria-labels and ids built from a hostile title stay inside their attribute', () => {
  const pages = pagesFor({ title: '"><b onmouseover=alert(1)>x', author: "' onfocus='alert(1)", id: '1"><script>alert(1)</script>' });
  const html = pages['books.html'];
  assert.equal(foreignMarkup(html), null);
  // every attribute value is closed properly: no raw quote inside aria-label values
  for (const m of html.matchAll(/aria-label="([^"]*)"/g)) assert.ok(!/[<>]/.test(m[1]), m[1]);
  assert.ok(!/id="[^"]*[<>' ][^"]*"/.test(html));
});

test('Book Id with odd characters yields safe DOM ids and CSS selectors', () => {
  const html = pagesFor({ id: '12 3}{;<x>' })['books.html'];
  assert.ok(!/<style>[^]*[<>]x[^]*<\/style>/.test(html));
  for (const m of html.matchAll(/ id="([^"]*)"/g)) assert.match(m[1], /^[A-Za-z0-9_-]+$/);
});

test('books-extra: recommendedBy is escaped and capped; non-strings ignored', () => {
  const b = rowToBook({ 'Book Id': '1', Title: 'x', 'Exclusive Shelf': 'read' });
  const m = mergeExtra(b, { 1: { recommendedBy: '<script>alert(1)</script>'.repeat(10) } });
  assert.ok(m.recommendedBy.length <= 60);
  assert.equal(mergeExtra(b, { 1: { recommendedBy: { toString() { return 'x'; } } } }).recommendedBy, '');
  assert.equal(mergeExtra(b, { 1: { recommendedBy: 42 } }).recommendedBy, '');
  const html = pagesFor({}, { extras: { 1: { favorite: true, recommendedBy: '"><img src=x onerror=alert(1)>' } } })['books.html'];
  assert.equal(foreignMarkup(html), null);
  assert.ok(html.includes('recommended by &quot;&gt;&lt;img'));
});

test('books-extra: favorite must be literally true; strings and numbers do not count', () => {
  const b = rowToBook({ 'Book Id': '1', Title: 'x', 'Exclusive Shelf': 'read' });
  for (const v of ['true', 1, 'yes', null, {}]) assert.equal(mergeExtra(b, { 1: { favorite: v } }).favorite, false);
  assert.equal(mergeExtra(b, { 1: { favorite: true } }).favorite, true);
});

test('books-extra: color must be exactly #rrggbb, so CSS cannot be injected through it', () => {
  const evil = [
    'red', '#fff', '#12345', '#1234567', '#12345g', 'url(javascript:alert(1))', 'red;} body{display:none',
    '#112233"><script>alert(1)</script>', '#112233;background:url(//evil/x)', '#112233 ', ' #112233', "#112233'", 'expression(alert(1))', '#11223\n3', 123456, null, ['#112233'],
  ];
  const b = rowToBook({ 'Book Id': '1', Title: 'x', 'Exclusive Shelf': 'read' });
  const problems = [];
  for (const c of evil) {
    try {
      const got = mergeExtra(b, { 1: { color: c } }).color;
      if (got !== '') problems.push(`${JSON.stringify(c)} was accepted as ${got}`);
    } catch (err) {
      problems.push(`${JSON.stringify(c)} threw ${err.message} (src/books.mjs isHexColor uses String(value), so an array like ["#112233"] passes the check and then .toLowerCase fails)`);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(mergeExtra(b, { 1: { color: '#AABBCC' } }).color, '#aabbcc');
  // end to end: the injected text appears nowhere
  const html = pagesFor({}, { extras: { 1: { color: 'red;} body{display:none' } } })['books.html'];
  assert.ok(!html.includes('display:none'));
});

test('books-extra: keys like __proto__, constructor and toString do not break or pollute', () => {
  const extras = JSON.parse('{"__proto__":{"favorite":true},"constructor":{"favorite":true},"toString":{"favorite":true}}');
  const { warnings, books } = buildPages({ csvText: csvOf({}), extras });
  assert.equal(books[0].favorite, false);
  assert.equal(({}).favorite, undefined);
  assert.ok(warnings.length >= 2);
});

test('books-extra: an entry for a book that does not exist only warns', () => {
  const { warnings, pages } = buildPages({ csvText: csvOf({}), extras: { 424242: { favorite: true }, _note: 'x' } });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('424242'));
  assert.ok(pages['books.html']);
});

test('books-extra: null, array and string extras do not throw', () => {
  for (const extras of [null, [], 'hi', 5]) assert.doesNotThrow(() => buildPages({ csvText: csvOf({}), extras }));
});

test('spine colors: a hostile cached color is a latent hole in the style attribute (cache is Zee-owned, still worth checking)', () => {
  // content/spine-colors.json is written by the build from sips output, so only a hand edit can put
  // junk here. This test pins the behavior so a regression or an accidental hand edit is noticed.
  const html = buildPages({ csvText: csvOf({}).replace(',,,3,', ',,="0141439688",3,'), colors: { '0141439688': '#112233' } }).pages['books.html'];
  assert.ok(html.includes('--c:#112233'));
});

test('spine colors: a malformed cached value never leaks into the style attribute (a clean refusal to build is acceptable)', () => {
  const csv = csvOf({}).replace(',,,3,', ',,="0141439688",3,');
  for (const bad of ['red" onmouseover="alert(1)', '#112233"><script>alert(1)</script>', 'url(//evil)', '']) {
    let html;
    try { html = buildPages({ csvText: csv, colors: { '0141439688': bad } }).pages['books.html']; }
    catch (err) { assert.match(err.message, /color/i); continue; }
    assert.equal(foreignMarkup(html), null, JSON.stringify(bad));
    assert.ok(!html.includes('onmouseover'), JSON.stringify(bad));
  }
});

// ---- site.config.json ----------------------------------------------------------------------------

test('config: URLs must be http(s); everything else becomes the placeholder', () => {
  const bad = ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.com', 'file:///etc/passwd', 'https://a.com/" onclick="x', "https://a.com/'x", 'https://a.com/<x>', 'https://a.com/ x', 'https://a.com/\nx', '', null, 5, {}];
  for (const u of bad) {
    const c = normalizeConfig({ artSiteUrl: u, artInstagramUrl: u, linkedinUrl: u, substackUrl: u });
    for (const k of ['artSiteUrl', 'artInstagramUrl', 'linkedinUrl', 'substackUrl']) assert.equal(c[k], DEFAULT[k], `${k} for ${String(u)}`);
  }
  assert.equal(safeUrl('https://ok.example/a?b=1&c=2'), 'https://ok.example/a?b=1&c=2');
});

test('config: javascript: URLs never reach an href on any page', () => {
  const configRaw = { name: 'Z', artSiteUrl: 'javascript:alert(1)', artInstagramUrl: 'javascript:alert(2)', linkedinUrl: 'JaVaScRiPt:alert(3)', substackUrl: 'javascript:alert(4)', resumePath: 'javascript:alert(5)' };
  const projectsRaw = [{ title: 'P', links: [{ label: 'x', url: 'javascript:alert(6)' }, { label: 'y', url: 'data:text/html,hi' }] }];
  for (const [name, html] of Object.entries(buildPages({ csvText: csvOf({}), configRaw, projectsRaw }).pages)) {
    assert.ok(!/javascript:|data:text/i.test(html), name);
  }
});

test('config: resumePath cannot be a URL, absolute, traversal, or contain quotes/spaces', () => {
  for (const p of ['javascript:alert(1)', 'https://evil.com/x.pdf', '/etc/passwd', '../secret.pdf', 'a/../../b', 'a b.pdf', 'a".pdf', "a'.pdf", '<x>.pdf', 'data:text/html,x', '\\\\server\\share', 'C:\\x.pdf']) {
    const got = normalizeConfig({ resumePath: p }).resumePath;
    assert.ok(got === 'resume.pdf', `${p} became ${got}`);
  }
  assert.equal(normalizeConfig({ resumePath: 'docs/my-cv.pdf' }).resumePath, 'docs/my-cv.pdf');
});

test('config: name is escaped and capped; null/array config does not crash', () => {
  const html = buildPages({ csvText: csvOf({}), configRaw: { name: '<script>alert(1)</script>' + 'x'.repeat(200) } }).pages['index.html'];
  assert.equal(foreignMarkup(html), null);
  assert.equal(normalizeConfig({ name: 'x'.repeat(500) }).name.length, 80);
  const crashed = [null, [], 'hello', 5].filter((v) => { try { normalizeConfig(v); return false; } catch { return true; } });
  assert.deepEqual(crashed, [], 'site.config.json holding one of these should fall back to defaults, not throw a TypeError');
});

test('config: a name that is not a string does not print [object Object]', () => {
  assert.notEqual(normalizeConfig({ name: { a: 1 } }).name, '[object Object]');
});

// ---- projects.json ------------------------------------------------------------------------------

test('projects: hostile fields are escaped, link URLs filtered, slug cannot escape the folder', () => {
  const projectsRaw = [
    { title: '<img src=x onerror=alert(1)>', slug: '../../evil', tagline: '"><script>', what: '<script>', role: '<b>', links: [{ label: '<i>', url: 'https://ok.example/' }, { label: 'bad', url: 'javascript:alert(1)' }], built: ['<script>'], problem: '<script>', learned: '<script>' },
    { title: 'Two', slug: 'a/b\\c' },
    { title: 'Three', slug: '' },
  ];
  const { pages } = buildPages({ csvText: csvOf({}), projectsRaw });
  for (const [name, html] of Object.entries(pages)) {
    assert.equal(foreignMarkup(html), null, name);
    assert.ok(!name.includes('..'), name);
    assert.match(name, /^[A-Za-z0-9_./-]+$/);
  }
  assert.equal(Object.keys(pages).filter((k) => k.startsWith('projects/')).length, 3);
});

test('projects: duplicate slugs and missing titles are dropped, not crashed on', () => {
  const { pages } = buildPages({ csvText: csvOf({}), projectsRaw: [{ title: 'Same' }, { title: 'Same' }, {}, null, 'str', { title: '' }] });
  assert.equal(Object.keys(pages).filter((k) => k.startsWith('projects/')).length, 1);
  assert.doesNotThrow(() => buildPages({ csvText: csvOf({}), projectsRaw: 'nope' }));
  assert.doesNotThrow(() => buildPages({ csvText: csvOf({}), projectsRaw: null }));
});

test('projects: at most four tins on the study, all of them on the projects page', () => {
  const projectsRaw = Array.from({ length: 6 }, (_, i) => ({ title: `Proj ${i}` }));
  const { pages } = buildPages({ csvText: csvOf({}), projectsRaw });
  assert.equal((pages['index.html'].match(/<div class="tin [a-d]">/g) || []).length, 4);
  assert.equal((pages['projects.html'].match(/class="tin"/g) || []).length, 6);
});

// ---- essay meta tags -----------------------------------------------------------------------------

test('essays: meta content with entities is shown as text, never decoded into markup', () => {
  const e = parseEssay('<meta name="essay-title" content="&lt;script&gt;alert(1)&lt;/script&gt;"><meta name="essay-date" content="2026-10-30"><meta name="essay-summary" content="&lt;img src=x onerror=alert(1)&gt;">', 'x.html');
  assert.equal(e.error, undefined);
  const html = buildPages({ csvText: csvOf({}), essays: [e] }).pages;
  for (const [name, h] of Object.entries(html)) assert.equal(foreignMarkup(h), null, name);
  assert.ok(html['writing.html'].includes('&lt;script&gt;alert(1)'));
});

test('essays: javascript: / data: substack link is dropped; https kept', () => {
  const mk = (u) => parseEssay(`<meta name="essay-title" content="T"><meta name="essay-date" content="2026-10-30"><meta name="essay-substack" content="${u}">`, 't.html');
  assert.equal(mk('javascript:alert(1)').substackUrl, '');
  assert.equal(mk('data:text/html,x').substackUrl, '');
  assert.equal(mk('https://x.substack.com/p/a').substackUrl, 'https://x.substack.com/p/a');
});

test('essays: summary is capped at 160 characters', () => {
  const e = parseEssay(`<meta name="essay-title" content="T"><meta name="essay-date" content="2026-10-30"><meta name="essay-summary" content="${'s'.repeat(500)}">`, 't.html');
  assert.equal(e.summary.length, 160);
});

test('essays: missing/invalid title or date returns an error naming the file', () => {
  assert.match(parseEssay('<meta name="essay-date" content="2026-10-30">', 'a.html').error, /a\.html/);
  assert.match(parseEssay('<meta name="essay-title" content="T">', 'b.html').error, /b\.html/);
  assert.match(parseEssay('<meta name="essay-title" content="T"><meta name="essay-date" content="30/10/2026">', 'c.html').error, /c\.html/);
  assert.match(parseEssay('', 'd.html').error, /d\.html/);
});

test('essays: an impossible date (month 13, day 99) is rejected rather than printed as "undefined 99"', () => {
  for (const d of ['2026-13-01', '2026-00-10', '2026-02-45', '2026-10-00', '9999-99-99']) {
    const e = parseEssay(`<meta name="essay-title" content="T"><meta name="essay-date" content="${d}">`, 'e.html');
    if (e.error) continue;
    const html = buildPages({ csvText: csvOf({}), essays: [e] }).pages['writing.html'];
    assert.ok(!html.includes('undefined'), `date ${d} rendered "undefined" on writing.html`);
    assert.fail(`date ${d} was accepted by parseEssay`);
  }
});

test('essays: single-quoted and reordered attributes parse; a ">" inside content fails gracefully with an error', () => {
  assert.equal(parseMetaTags(`<meta content='B' name='Essay-Title'>`)['essay-title'], 'B');
  const e = parseEssay('<meta name="essay-title" content="a > b"><meta name="essay-date" content="2026-10-30">', 'g.html');
  assert.ok(e.error || e.title === 'a > b');
});

test('essays: file name with odd characters cannot break the href', () => {
  const e = parseEssay('<meta name="essay-title" content="T"><meta name="essay-date" content="2026-10-30">', 'a"><script>alert(1)</script>.html');
  const html = buildPages({ csvText: csvOf({}), essays: [e] }).pages['writing.html'];
  assert.equal(foreignMarkup(html), null);
});

test('spineStyle itself: a book override color wins and is lowercase', () => {
  assert.equal(spineStyle({ color: '#ABCDEF', title: 't', pages: 1, pubYear: 0, spineTitle: 't' }, '#000000').bg, '#abcdef');
});
