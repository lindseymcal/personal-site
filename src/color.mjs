// Color helpers: hex <-> rgb, contrast, and picking readable text. Pure functions.

export function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a #RRGGBB color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// WCAG relative luminance, 0 (black) .. 1 (white).
export function relativeLuminance(hex) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio, 1 .. 21.
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const CREAM = '#FBF3E2';
const INK = '#1B1713';

// Lettering color for a spine: warm cream or dark ink, whichever reads better.
// If neither reaches `min` (a mid-tone background), fall back to pure white or black.
export function readableTextColor(bg, min = 4.5) {
  const best = contrastRatio(bg, CREAM) >= contrastRatio(bg, INK) ? CREAM : INK;
  if (contrastRatio(bg, best) >= min) return best;
  return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#000000') ? '#FFFFFF' : '#000000';
}
