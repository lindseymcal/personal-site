// Reading and checking the files Zee edits: site.config.json, content/projects.json, and essay pages.
// Everything here takes plain values and returns plain values, so tests do not need files.
import { decodeBasicEntities, slugify } from './books.mjs';

// Only http(s) links (and a few safe relative paths) are allowed through; anything else becomes '#'.
export function safeUrl(value, fallback = '#') {
  const s = String(value ?? '').trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  return fallback;
}

// A local file path such as resume.pdf: no scheme, no "..", no leading slash.
export function safeLocalPath(value, fallback = 'resume.pdf') {
  const s = String(value ?? '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.includes('..') || s.includes('\\') || /[\s"'<>]/.test(s)) return fallback;
  return s;
}

export const DEFAULT_CONFIG = {
  name: 'Your Name',
  artSiteUrl: 'https://art.example.com',
  artInstagramUrl: 'https://www.instagram.com/your-handle',
  linkedinUrl: 'https://www.linkedin.com/in/your-name',
  substackUrl: 'https://your-name.substack.com',
  resumePath: 'resume.pdf',
  reviews: 'chosen', // which reviews to publish: 'all' | 'chosen' | 'none' (default: only ones marked showReview)
};

// Fails closed: not set at all means the default ("chosen"), but anything set to something unknown
// (a typo, wrong case, a stray space) means "none", so a mistake can never publish more than intended.
export const REVIEW_MODES = ['all', 'chosen', 'none'];
export function normalizeReviewsSetting(value) {
  if (value === undefined) return DEFAULT_CONFIG.reviews;
  return REVIEW_MODES.includes(value) ? value : 'none';
}

export function normalizeConfig(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const c = { ...DEFAULT_CONFIG };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  c.name = name ? name.slice(0, 80) : DEFAULT_CONFIG.name;
  for (const key of ['artSiteUrl', 'artInstagramUrl', 'linkedinUrl', 'substackUrl']) {
    c[key] = safeUrl(raw[key], DEFAULT_CONFIG[key]);
  }
  c.reviews = normalizeReviewsSetting(raw.reviews);
  c.resumePath = safeLocalPath(raw.resumePath, DEFAULT_CONFIG.resumePath);
  return c;
}

// https://name.substack.com -> https://name.substack.com/subscribe
export function substackSubscribeUrl(substackUrl) {
  const base = safeUrl(substackUrl, '');
  if (!base) return '#';
  // a profile address on substack.com itself (https://substack.com/@name) is already the right page
  try { if (/^(www\.)?substack\.com$/i.test(new URL(base).hostname)) return base; } catch { return '#'; }
  return base.replace(/\/+$/, '') + '/subscribe';
}

// --- projects ---------------------------------------------------------------------------------

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// A project picture: a local file under assets/projects/ (jpg, webp or png) with alt text and its size.
export function normalizeProjectImage(img) {
  const src = String(img?.src ?? '');
  const width = Number(img?.width), height = Number(img?.height);
  if (!/^assets\/projects\/[a-z0-9-]+\.(jpg|webp|png)$/.test(src)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4000 || height > 4000) return null;
  const alt = clip(img?.alt, 300);
  return alt ? { src, alt, width, height } : null;
}

export function normalizeProject(p) {
  const title = clip(p?.title, 80);
  const slug = slugify(p?.slug || title);
  return {
    slug,
    title,
    tagline: clip(p?.tagline, 120),
    what: clip(p?.what, 400),
    role: clip(p?.role, 80),
    when: clip(p?.when, 60),
    builtWith: clip(p?.builtWith, 80),
    status: clip(p?.status, 60),
    links: (Array.isArray(p?.links) ? p.links : [])
      .map((l) => ({ label: clip(l?.label, 40), url: safeUrl(l?.url, '') }))
      .filter((l) => l.label && l.url)
      .slice(0, 3),
    image: normalizeProjectImage(p?.image),
    problem: clip(p?.problem, 600),
    built: (Array.isArray(p?.built) ? p.built : []).map((x) => clip(x, 160)).filter(Boolean).slice(0, 6),
    learned: clip(p?.learned, 600),
  };
}

export function normalizeProjects(list) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const n = normalizeProject(p);
    if (!n.title || seen.has(n.slug)) continue;
    seen.add(n.slug);
    out.push(n);
  }
  return out;
}

// --- essays -----------------------------------------------------------------------------------

// Reads <meta name="..." content="..."> tags out of an essay file. Returns { name: content }.
export function parseMetaTags(html) {
  const meta = {};
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/i);
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    if (name && content) meta[(name[1] ?? name[2]).toLowerCase()] = decodeBasicEntities(content[1] ?? content[2]);
  }
  return meta;
}

// An essay file needs:
//   <meta name="essay-title" content="...">   <meta name="essay-date" content="2026-10-30">
// and optionally  <meta name="essay-summary" content="...">  <meta name="essay-substack" content="https://...">
// Returns { error } instead of throwing so the build can name the file with the problem.
export function parseEssay(html, fileName) {
  const meta = parseMetaTags(html);
  const title = (meta['essay-title'] ?? '').trim();
  const date = (meta['essay-date'] ?? '').trim();
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!title) return { error: `${fileName}: add <meta name="essay-title" content="...">` };
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return { error: `${fileName}: essay-date must be a real date like 2026-10-30` };
  return {
    slug: fileName.replace(/\.html$/, ''),
    title,
    date,
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    summary: (meta['essay-summary'] ?? '').trim().slice(0, 160),
    substackUrl: safeUrl(meta['essay-substack'], ''),
    // the tag is there but is not a usable web address
    substackRejected: (meta['essay-substack'] ?? '').trim() !== '' && safeUrl(meta['essay-substack'], '') === '',
  };
}

// Newest first, grouped by year: [{ year, essays: [...] }]
export function groupEssaysByYear(essays) {
  const sorted = [...essays].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));
  const groups = [];
  for (const e of sorted) {
    let g = groups[groups.length - 1];
    if (!g || g.year !== e.year) { g = { year: e.year, essays: [] }; groups.push(g); }
    g.essays.push(e);
  }
  return groups;
}

// Years alternate between the left and right page of the notebook (newest on the left).
export function splitYearsAcrossPages(groups) {
  return { left: groups.filter((_, i) => i % 2 === 0), right: groups.filter((_, i) => i % 2 === 1) };
}

// The essay footer link sits between two comment markers so the build can regenerate it from the
// essay's essay-substack meta tag (one place to edit). To protect the essay text, it only rewrites when
// there is exactly one opening and one closing marker, in that order, and what sits between them is just
// a single <a ...>...</a> link. Otherwise the file is left alone and the reason says why.
// Returns { ok: true, html } or { ok: false, reason }.
export function applyEssayFooter(html, linkHtml) {
  const OPEN = '<!--substack-link-->';
  const CLOSE = '<!--/substack-link-->';
  const opens = html.split(OPEN).length - 1;
  const closes = html.split(CLOSE).length - 1;
  if (opens === 0 && closes === 0) return { ok: false, reason: 'no substack-link markers around the footer link' };
  if (opens !== 1 || closes !== 1) return { ok: false, reason: `expected exactly one opening and one closing substack-link marker, found ${opens} and ${closes}` };
  const start = html.indexOf(OPEN) + OPEN.length;
  const end = html.indexOf(CLOSE);
  if (end < start) return { ok: false, reason: 'the closing substack-link marker comes before the opening one' };
  const between = html.slice(start, end);
  const single = /^\s*<a\b[^>]*>[\s\S]*?<\/a>\s*$/.test(between)
    && (between.match(/<a\b/g) || []).length === 1 && (between.match(/<\/a>/g) || []).length === 1;
  if (!single) return { ok: false, reason: 'the text between the markers is not just one link, so nothing was replaced' };
  return { ok: true, html: `${html.slice(0, start)}\n      ${linkHtml}\n      ${html.slice(end)}` };
}
