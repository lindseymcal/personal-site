// Everything that decides how a book's spine looks. Pure functions (no files, no network).
import { hexToRgb, rgbToHex, readableTextColor, contrastRatio } from './color.mjs';

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

// Spine thickness in px, linear in the page count so it is plainly visible: about 31px at 100 pages,
// 56px at 400, 90px at 800, and never wider than 96px. Missing page count: a middling 44px.
export const SPINE_MIN_WIDTH = 26;
export const SPINE_MAX_WIDTH = 96;
export const SPINE_DEFAULT_WIDTH = 44;
export function spineWidth(pages) {
  if (!pages || pages < 1) return SPINE_DEFAULT_WIDTH;
  return Math.max(SPINE_MIN_WIDTH, Math.min(SPINE_MAX_WIDTH, Math.round(22 + pages * 0.085)));
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

// --- fitting the title on the spine -----------------------------------------------------------
// The title runs up the spine; a long title wraps into several columns side by side. We work out the
// lines at build time (no script on the page) from rough letter widths, with a safety margin, and the CSS
// clips and adds an ellipsis as a last resort, so the lettering can never reach the rule or the author.

export const SPINE_MIN_FONT = 10;
export const SPINE_MAX_FONT = 19;
const SPINE_SIDE_PADDING = 8;      // total left+right breathing room, px
const SPINE_LINE_HEIGHT = 1.18;    // column width as a multiple of the font size
const SPINE_SAFETY = 1.1;          // letters are never wider than we think

// Average letter width as a share of the font size, per typeface (they differ a lot).
export function letterWidthFactor(family, caps) {
  const base = {
    'Cinzel': 0.84,
    'Playfair Display SC': 0.8,
    'IM Fell English SC': 0.74,
    'Libre Baskerville': 0.64,
    'Josefin Sans': 0.72,
  }[family] ?? 0.8;
  return (caps && family !== 'Josefin Sans' ? base * 1.08 : base) + 0.02; // +0.02 for letter spacing
}

// Room (px) along the spine for the title: the spine's height minus top padding, the star (if any),
// and the author block with its rule.
export function titleRoom(height, favorite, authorHeight = AUTHOR_HEIGHT) {
  return height - 18 - (favorite ? 21 : 0) - (authorHeight + 10) - 6;
}

// The author under the rule. Normally one line of small type across the spine. If the name is too long to
// fit across a thin spine, it runs up the spine instead, in a taller block (that takes room from the title).
export const AUTHOR_HEIGHT = 19;
const AUTHOR_CHAR_PX = 5.6; // rough width of one letter at 9.5px, with margin
const AUTHOR_MAX_HEIGHT = 80;
export function authorLayout(author, width) {
  const n = String(author ?? '').length;
  if (n * AUTHOR_CHAR_PX <= width - 8) return { vertical: false, height: AUTHOR_HEIGHT };
  return { vertical: true, height: Math.min(AUTHOR_MAX_HEIGHT, Math.ceil(n * AUTHOR_CHAR_PX) + 9) };
}

// Greedy word wrap into lines of at most maxChars characters. A word longer than maxChars is split.
export function wrapTitle(text, maxChars) {
  const lines = [];
  let line = '';
  const push = () => { if (line) { lines.push(line); line = ''; } };
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > maxChars) { // too long for any line: break it
      push();
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!w) continue;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
    else { push(); line = w; }
  }
  push();
  return lines;
}

// Picks the biggest font that fits, in as many columns as the spine is wide.
// Returns { lines, fontSize, truncated }. At the smallest size, text that still does not fit is cut with an ellipsis.
//   room / columnsWidth / minFont let a caller (the cover labels) say exactly how much space there is
export function fitSpineTitle(title, { width, height, family, caps = false, favorite = false, authorHeight = AUTHOR_HEIGHT, room: roomOverride, columnsWidth, minFont = SPINE_MIN_FONT }) {
  const text = String(title).replace(/\s+/g, ' ').trim() || ' ';
  const room = roomOverride ?? titleRoom(height, favorite, authorHeight);
  const avail = columnsWidth ?? (width - SPINE_SIDE_PADDING);
  const factor = letterWidthFactor(family, caps) * SPINE_SAFETY;
  const layoutAt = (fs) => ({
    maxChars: Math.max(1, Math.floor(room / (fs * factor))),
    columns: Math.max(1, Math.floor(avail / (fs * SPINE_LINE_HEIGHT))),
  });
  for (let fs = SPINE_MAX_FONT; fs >= minFont; fs -= 0.5) {
    const { maxChars, columns } = layoutAt(fs);
    const lines = wrapTitle(text, maxChars);
    const longestWord = Math.max(...text.split(' ').map((w) => w.length));
    // a one-column title may be sized freely, but never wider than the spine allows
    if (lines.length <= columns && longestWord <= maxChars && (columns > 1 || fs <= width * 0.45)) {
      return { lines, fontSize: fs, truncated: false };
    }
  }
  const { maxChars, columns } = layoutAt(minFont);
  let lines = wrapTitle(text, maxChars);
  if (lines.length <= columns) return { lines, fontSize: minFont, truncated: false };
  lines = lines.slice(0, columns);
  const last = lines[columns - 1];
  lines[columns - 1] = `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  return { lines, fontSize: minFont, truncated: true };
}

// Everything the template needs for one spine.
//   colorHex  the color read from the cover (or null)  - cached outside the repo (see scripts/build.mjs)
export function spineStyle(book, colorHex) {
  const bg = book.color || colorHex || fallbackColor(book.title);
  const width = spineWidth(book.pages);
  const height = spineHeight(book.pages, book.title);
  const face = spineTypeface(book.pubYear, book.title);
  const text = readableTextColor(bg);
  const author = authorLayout(book.spineAuthor, width);
  const fitted = fitSpineTitle(book.spineTitle, { width, height, family: face.family, caps: face.caps, favorite: book.favorite, authorHeight: author.height });
  const showBand = hashText(book.title + '#band') % 2 === 0;
  return {
    bg: bg.toLowerCase(),
    text,
    band: showBand ? text : '',
    family: face.family,
    caps: face.caps,
    width,
    height,
    authorVertical: author.vertical,
    authorHeight: author.height,
    fontSize: fitted.fontSize,
    lines: fitted.lines,
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
  return Math.max(13, Math.min(34, Math.round(11 + pages * 0.026)));
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

// --- spines cut from the real cover (the --covers preview) -------------------------------------
// Designer's rules: a solid label in the cover's own main color (88% opaque) with a hairline, inset 5px,
// from 15% down to 9% above the bottom, so the art shows above and below. Text color is chosen by contrast
// against the label over BOTH the darkest and the lightest pixel under it (4.5:1 for both). Very busy covers
// get a cream paper label with dark ink. Titles stay at 11px or more; thin spines drop the author.

export const COVER_LABEL_ALPHA = 0.88;
export const COVER_MIN_FONT = 11;
export const COVER_THIN_SPINE = 28;
export const PAPER_LABEL = { bg: '#F4ECD8', text: '#2A2620' };

function blendHex(labelHex, underHex, alpha) {
  const a = hexToRgb(labelHex);
  const b = hexToRgb(underHex);
  return rgbToHex(a.map((v, i) => v * alpha + b[i] * (1 - alpha)));
}

// stats: { main, dark, light, busy } as produced by coverStats. Returns { kind, bg, text, ratio }.
export function coverLabelColors(stats) {
  if (stats.busy) return { kind: 'paper', bg: PAPER_LABEL.bg, text: PAPER_LABEL.text, ratio: contrastRatio(PAPER_LABEL.bg, PAPER_LABEL.text) };
  const over = [blendHex(stats.main, stats.dark, COVER_LABEL_ALPHA), blendHex(stats.main, stats.light, COVER_LABEL_ALPHA)];
  let best = null;
  for (const text of ['#FBF3E2', '#1B1713', '#FFFFFF', '#000000']) {
    const ratio = Math.min(...over.map((bg) => contrastRatio(bg, text)));
    if (!best || ratio > best.ratio) best = { text, ratio };
    if (ratio >= 4.5 && text !== '#FFFFFF' && text !== '#000000') { best = { text, ratio }; break; }
  }
  if (best.ratio < 4.5) return { kind: 'paper', bg: PAPER_LABEL.bg, text: PAPER_LABEL.text, ratio: contrastRatio(PAPER_LABEL.bg, PAPER_LABEL.text) };
  const [r, g, b] = hexToRgb(stats.main);
  return { kind: 'color', bg: `rgba(${r},${g},${b},${COVER_LABEL_ALPHA})`, text: best.text, ratio: best.ratio };
}

// Everything the template needs to draw the label on a cover spine.
export function coverSpineLayout(book, st, stats) {
  const label = coverLabelColors(stats);
  const showAuthor = st.width >= COVER_THIN_SPINE && Boolean(book.spineAuthor);
  const labelHeight = st.height * (1 - 0.15 - 0.09);
  const fitted = fitSpineTitle(book.spineTitle, {
    width: st.width, height: st.height, family: st.family, caps: st.caps,
    room: labelHeight - 8 - 5 - (showAuthor ? 14 : 0),
    columnsWidth: st.width - 10 - 6,
    minFont: COVER_MIN_FONT,
  });
  return { ...label, showAuthor, lines: fitted.lines, fontSize: fitted.fontSize };
}
