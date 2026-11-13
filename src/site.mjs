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
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.includes('..') || /[\s"'<>]/.test(s)) return fallback;
  return s;
}

export const DEFAULT_CONFIG = {
  name: 'Your Name',
  artSiteUrl: 'https://art.example.com',
  artInstagramUrl: 'https://www.instagram.com/your-handle',
  linkedinUrl: 'https://www.linkedin.com/in/your-name',
  substackUrl: 'https://your-name.substack.com',
  resumePath: 'resume.pdf',
};

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  const name = String(raw.name ?? '').trim();
  c.name = name ? name.slice(0, 80) : DEFAULT_CONFIG.name;
  for (const key of ['artSiteUrl', 'artInstagramUrl', 'linkedinUrl', 'substackUrl']) {
    c[key] = safeUrl(raw[key], DEFAULT_CONFIG[key]);
  }
  c.resumePath = safeLocalPath(raw.resumePath, DEFAULT_CONFIG.resumePath);
  return c;
}

// https://name.substack.com -> https://name.substack.com/subscribe
export function substackSubscribeUrl(substackUrl) {
  const base = safeUrl(substackUrl, '');
  if (!base) return '#';
  return base.replace(/\/+$/, '') + '/subscribe';
}

// --- projects ---------------------------------------------------------------------------------

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

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
  if (!m) return { error: `${fileName}: essay-date must look like 2026-10-30` };
  return {
    slug: fileName.replace(/\.html$/, ''),
    title,
    date,
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    summary: (meta['essay-summary'] ?? '').trim().slice(0, 160),
    substackUrl: safeUrl(meta['essay-substack'], ''),
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
