// Turning Goodreads CSV rows into book objects the pages can use.
// Everything here is pure (no files, no network) so tests can cover it.
//
// PRIVACY: only the columns named in rowToBook are ever read. "Private Notes" is never touched.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- escaping -------------------------------------------------------------------------------

// Escape text for putting inside HTML (element content or a double-quoted attribute).
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Goodreads text sometimes holds HTML entities such as &amp; or &#39;. Turn a few back into
// plain characters so the single escapeHtml pass later does not double-escape them.
// (Decoded text is always escaped again before it reaches a page.)
export function decodeBasicEntities(text) {
  return String(text ?? '')
    .replace(/&#(\d{1,6});/g, (m, n) => safeCodePoint(Number(n), m))
    .replace(/&#x([0-9a-f]{1,5});/gi, (m, h) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n, fallback) {
  if (!Number.isInteger(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return fallback;
  return String.fromCodePoint(n);
}

// A Goodreads review -> an array of plain-text paragraphs.
// <br/> (and real line breaks) separate paragraphs; any other tag is removed; nothing is kept as HTML.
export function reviewToParagraphs(review) {
  const text = String(review ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|blockquote|li|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ''); // drop the remaining tags (<i>, <a href=...>, <script>...)
  return decodeBasicEntities(text)
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// The same paragraphs as safe HTML: each one escaped, wrapped in <p>.
export function reviewToHtml(review) {
  return reviewToParagraphs(review).map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
}

// --- small cleanups ---------------------------------------------------------------------------

// Goodreads writes ISBNs as ="0123456789". Returns digits (and a trailing X) or '' if not usable.
export function cleanIsbn(raw) {
  const s = String(raw ?? '').replace(/[="'\s-]/g, '').toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(s) ? s : '';
}

// Prefer the 13-digit ISBN, else the 10-digit one.
export function pickIsbn(isbn13, isbn10) {
  return cleanIsbn(isbn13) || cleanIsbn(isbn10);
}

// "My Rating" -> whole number 0..5 (0 means unrated).
export function parseRating(raw) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

export function parsePages(raw) {
  const n = Number.parseInt(String(raw ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseYear(raw) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 && n < 3000 ? n : 0;
}

// Goodreads dates look like 2026/10/14 (also accepts 2026-10-14). Returns {year, month, day} or null.
export function parseGoodreadsDate(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatMonthYear(date) {
  return `${MONTHS[date.month - 1]} ${date.year}`;
}

// "read Oct 2026" from Date Read, else "shelved Oct 2026" from Date Added, else nothing.
// Also returns the year (for grouping) and a sortable key.
export function bookWhen(dateRead, dateAdded) {
  const read = parseGoodreadsDate(dateRead);
  const added = parseGoodreadsDate(dateAdded);
  const d = read || added;
  if (!d) return { label: '', year: 0, sortKey: '0000-00-00' };
  const sortKey = `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  return { label: `${read ? 'read' : 'shelved'} ${formatMonthYear(d)}`, year: d.year, sortKey };
}

// "Middlemarch (Penguin Classics)" -> "Middlemarch"; "Walden; or, Life in the Woods" stays whole here (spineTitle shortens it).
export function stripSeries(title) {
  return String(title ?? '').replace(/\s*\([^()]*\)\s*$/, '').trim();
}

// The title as printed on a spine: no series note, and no subtitle after a colon or semicolon.
export function spineTitle(title) {
  const t = stripSeries(title);
  const beforeBreak = t.split(/[:;]/)[0].trim();
  return beforeBreak.length >= 3 ? beforeBreak : t;
}

// "Austen, Jane" -> "Austen". Uses Goodreads "Author l-f"; falls back to the last word of "Author".
export function spineAuthor(authorLastFirst, author) {
  const lf = String(authorLastFirst ?? '').split(',')[0].trim();
  if (lf) return lf;
  const words = String(author ?? '').trim().split(/\s+/);
  return words[words.length - 1] || '';
}

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'book';
}

// --- row -> book ------------------------------------------------------------------------------

// Returns null for anything not on the "read" shelf. Only the columns listed here are used.
export function rowToBook(row) {
  if ((row['Exclusive Shelf'] ?? '').trim() !== 'read') return null;
  const id = String(row['Book Id'] ?? '').trim();
  const title = stripSeries(row['Title']);
  if (!id || !title) return null;
  const when = bookWhen(row['Date Read'], row['Date Added']);
  return {
    id,
    title,
    spineTitle: spineTitle(row['Title']),
    author: String(row['Author'] ?? '').trim(),
    spineAuthor: spineAuthor(row['Author l-f'], row['Author']),
    isbn: pickIsbn(row['ISBN13'], row['ISBN']),
    pages: parsePages(row['Number of Pages']),
    pubYear: parseYear(row['Original Publication Year']) || parseYear(row['Year Published']),
    rating: parseRating(row['My Rating']),
    review: String(row['My Review'] ?? ''),
    when: when.label,
    year: when.year,
    sortKey: when.sortKey,
    favorite: false,
    recommendedBy: '',
    color: '',
  };
}

export function rowsToBooks(rows) {
  return rows.map(rowToBook).filter(Boolean);
}

// --- Zee's own file: content/books-extra.json -------------------------------------------------

export function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

// extras is { "<Goodreads Book Id>": { favorite, recommendedBy, color } }. Keys starting with "_" are notes.
export function mergeExtra(book, extras) {
  const e = extras && Object.hasOwn(extras, book.id) ? extras[book.id] : null;
  if (!e || typeof e !== 'object') return book;
  return {
    ...book,
    favorite: e.favorite === true,
    recommendedBy: typeof e.recommendedBy === 'string' ? e.recommendedBy.trim().slice(0, 60) : '',
    color: isHexColor(e.color) ? e.color.toLowerCase() : '',
  };
}

// Book Ids in extras that match no book (probably a typo): worth a warning.
export function unmatchedExtraIds(books, extras) {
  const known = new Set(books.map((b) => b.id));
  return Object.keys(extras || {}).filter((k) => !k.startsWith('_') && !known.has(k));
}

// --- ordering and grouping --------------------------------------------------------------------

// Most recent first. Ties fall back to title so the order never changes between builds.
export function byRecent(a, b) {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1;
  return a.title.localeCompare(b.title);
}

// Shelves by year: newest year first, newest book first inside a year. Undated books go last.
export function groupByYear(books) {
  const map = new Map();
  for (const b of [...books].sort(byRecent)) {
    if (!map.has(b.year)) map.set(b.year, []);
    map.get(b.year).push(b);
  }
  const years = [...map.keys()].sort((a, b) => (a === 0) - (b === 0) || b - a);
  return years.map((y) => ({ year: y, label: y === 0 ? 'Undated' : String(y), books: map.get(y) }));
}

// THE HOME SHELF RULE (Zee hasn't confirmed it, so it lives here, in one place):
// favorites first (most recent first), then the most recent other reads, up to `capacity` books.
export function selectHomeShelf(books, capacity) {
  const favorites = books.filter((b) => b.favorite).sort(byRecent);
  const others = books.filter((b) => !b.favorite).sort(byRecent);
  return [...favorites, ...others].slice(0, Math.max(0, capacity));
}
