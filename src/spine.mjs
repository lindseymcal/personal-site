// Everything that decides how a book's spine looks. Pure functions (no files, no network).
import { rgbToHex, readableTextColor } from './color.mjs';

// Colors from the study, used when a book has no cover color.
export const STUDY_PALETTE = [
  '#7A4C6B', '#6F8A5B', '#3F7A7A', '#C9A040', '#B7837A', '#3B4A73',
  '#A8452F', '#24474F', '#6E2E35', '#5D6E7E', '#3E3A2E', '#8C5A78',
];

// A small, stable number from text (FNV-1a). Same text, same number, every build.
export function hashText(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Spine width in px from page count: a long book is a thick one. Unknown pages -> a middling width.
export function spineWidth(pages) {
  if (!pages || pages < 1) return 40;
  return Math.max(28, Math.min(76, Math.round(26 + pages * 0.055)));
}

// Spine height in px, 230..298: a little taller for long books, plus a steady wobble from the title.
export function spineHeight(pages, title) {
  const bulk = Math.min(Math.max(pages || 0, 0), 900) / 900 * 38;
  return Math.round(228 + bulk + (hashText(title) % 33));
}

// When there is no cover color: a deterministic study color from the title.
export function fallbackColor(title) {
  return STUDY_PALETTE[hashText(title) % STUDY_PALETTE.length];
}

// The five typefaces loaded on the books page, chosen by when the book was written.
//   before 1700   Cinzel (carved, classical)
//   1700 - 1849   Playfair Display SC or IM Fell English SC (the title decides which)
//   1850 - 1899   Libre Baskerville or IM Fell English SC
//   1900 and on   Josefin Sans (set in capitals)
//   unknown year  the title decides, among the serif ones
export function spineTypeface(pubYear, title) {
  const pick = (list) => list[hashText(title) % list.length];
  if (pubYear && pubYear < 1700) return { family: 'Cinzel', caps: false };
  if (pubYear && pubYear < 1850) return { family: pick(['Playfair Display SC', 'IM Fell English SC']), caps: false };
  if (pubYear && pubYear < 1900) return { family: pick(['Libre Baskerville', 'IM Fell English SC']), caps: false };
  if (pubYear) return { family: 'Josefin Sans', caps: true };
  return { family: pick(['Libre Baskerville', 'Playfair Display SC', 'Cinzel', 'IM Fell English SC']), caps: false };
}

// Font size (px) so the title fits along the spine and across its width.
export function spineFontSize(title, width, height, caps = false) {
  const length = Math.max(1, String(title).length);
  const room = height - 74; // space for the star, author and padding
  const perChar = caps ? 0.78 : 0.68; // rough width of a letter, as a share of the font size
  const byLength = room / (length * perChar);
  const byWidth = width * 0.4;
  return Math.round(Math.max(10, Math.min(19, byLength, byWidth)) * 2) / 2;
}

// Everything the template needs for one spine.
//   colorHex  the color read from the cover (or null)  - cached outside the repo (see scripts/build.mjs)
export function spineStyle(book, colorHex) {
  const bg = book.color || colorHex || fallbackColor(book.title);
  const width = spineWidth(book.pages);
  const height = spineHeight(book.pages, book.title);
  const face = spineTypeface(book.pubYear, book.title);
  const text = readableTextColor(bg);
  const showBand = hashText(book.title + '#band') % 2 === 0;
  return {
    bg: bg.toLowerCase(),
    text,
    band: showBand ? text : '',
    family: face.family,
    caps: face.caps,
    width,
    height,
    fontSize: spineFontSize(book.spineTitle, width, height, face.caps),
  };
}

// Cover color -> a spine-friendly color: nudge the extremes so the shelf stays a shelf
// (pure white spines vanish, and pure black ones are holes).
export function tuneCoverColor(rgb) {
  const [r, g, b] = rgb;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  let out = [r, g, b];
  if (lum > 225) out = out.map((v) => v * 0.9); // slightly warm the whites down toward the paper tones
  if (lum < 28) out = out.map((v) => v + 18);
  return rgbToHex(out);
}


// --- the small spines on the home-page shelf (no lettering, just color and thickness) ---

export function homeSpineWidth(pages) {
  if (!pages || pages < 1) return 22;
  return Math.max(16, Math.min(30, Math.round(14 + pages * 0.03)));
}

export function homeSpineHeight(title) {
  return 86 + (hashText(title) % 27);
}

// Title size on the big pulled-out book cover (250px wide): long titles get smaller type.
export function coverFontSize(title) {
  const n = String(title).length;
  if (n <= 12) return 34;
  if (n <= 20) return 28;
  if (n <= 32) return 23;
  return 19;
}
