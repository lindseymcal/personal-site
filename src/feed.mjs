// Essays come from Zee's Substack RSS feed. We read only the plain facts (title, date, a short summary and the
// address of the post) and link out to Substack; we never import a post's HTML (that would need a sanitizer).
// The network part is fetchFeed (one request, timeout, size cap, host allowlist); everything else is pure.
import { decodeBasicEntities, reviewToParagraphs } from './books.mjs';
import { safeUrl } from './site.mjs';

export const FEED_MAX_BYTES = 1_000_000;
export const FEED_MAX_ITEMS = 200;

// Allowed hosts: substack.com and its subdomains, plus any extra host given (a custom domain for the publication).
export function hostAllowed(hostname, extraHosts = []) {
  const h = String(hostname).toLowerCase();
  return /(^|\.)substack\.com$/.test(h) || extraHosts.some((x) => String(x).toLowerCase() === h);
}

function urlHostAllowed(url, extraHosts) {
  try { return hostAllowed(new URL(url).hostname, extraHosts); } catch { return false; }
}

// Plain text from a feed field: CDATA unwrapped, entities decoded, tags removed. Never HTML.
export function plainText(raw) {
  const unwrapped = String(raw ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  const isCdata = unwrapped !== String(raw ?? '');
  const text = isCdata ? unwrapped : decodeBasicEntities(unwrapped);
  return reviewToParagraphs(text).join(' ').replace(/\s+/g, ' ').trim();
}

function tag(item, name) {
  const m = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

// One entry, checked: { title, url, date: 'YYYY-MM-DD', summary }. Returns null when anything essential is wrong.
export function normalizeEntry(e, extraHosts = []) {
  const title = plainText(e?.title).slice(0, 140);
  const url = safeUrl(e?.url, '');
  const date = String(e?.date ?? '');
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!title || !url || !urlHostAllowed(url, extraHosts) || !m) return null;
  if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return null;
  return {
    title,
    url,
    date,
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    summary: plainText(e?.summary).slice(0, 160),
  };
}

// RSS XML text -> entries (newest first is decided later). Bad items are skipped.
export function parseFeed(xml, extraHosts = []) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const entries = [];
  for (const item of items.slice(0, FEED_MAX_ITEMS)) {
    const when = new Date(plainText(tag(item, 'pubDate')));
    if (Number.isNaN(when.getTime())) continue;
    const entry = normalizeEntry({
      title: tag(item, 'title'),
      url: plainText(tag(item, 'link')),
      date: when.toISOString().slice(0, 10),
      summary: tag(item, 'description'),
    }, extraHosts);
    if (entry) entries.push(entry);
  }
  return entries;
}

// The cache file holds { feedUrl, entries: [{ title, url, date, summary }] }. Re-checked on every read.
export function readFeedCache(cache, extraHosts = []) {
  return (Array.isArray(cache?.entries) ? cache.entries : []).map((e) => normalizeEntry(e, extraHosts)).filter(Boolean);
}
export function feedCacheObject(feedUrl, entries) {
  return { feedUrl, entries: entries.map(({ title, url, date, summary }) => ({ title, url, date, summary })) };
}

// One request. Returns { status: 'ok', xml } | { status: 'error', message }.
export async function fetchFeed(feedUrl, { fetchImpl = globalThis.fetch, extraHosts = [] } = {}) {
  try {
    const hosts = extraHosts; // substack.com is always allowed; a custom domain must be passed in explicitly
    if (!urlHostAllowed(feedUrl, hosts) || new URL(feedUrl).protocol !== 'https:') return { status: 'error', message: 'the feed address must be https on substack.com (or the publication\'s own domain)' };
    const res = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(15_000), redirect: 'follow', headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    if (res.url && !urlHostAllowed(res.url, hosts)) return { status: 'error', message: `unexpected host ${new URL(res.url).hostname}` };
    const type = res.headers?.get?.('content-type');
    if (type && !/xml|rss/i.test(type)) return { status: 'error', message: `not a feed (${type})` };
    if (Number(res.headers?.get?.('content-length')) > FEED_MAX_BYTES) return { status: 'error', message: 'the feed is too large' };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > FEED_MAX_BYTES) return { status: 'error', message: 'the feed is too large' };
    return { status: 'ok', xml: bytes.toString('utf8') };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}
