// Reading a cover thumbnail to decide how the title label on its spine should look. Pure functions.
import { dominantColor } from './bmp.mjs';
import { rgbToHex } from './color.mjs';

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
export const BUSY_STD_DEV = 58; // luminance spread (0..255) above which a cover is "very busy"

// The part of the cover that ends up under the label: a vertical strip near the left of the front cover,
// between 15% and 91% of its height.
export function stripRegion(width, height) {
  return { x0: Math.floor(width * 0.15), x1: Math.max(Math.floor(width * 0.15) + 1, Math.ceil(width * 0.55)), y0: Math.floor(height * 0.15), y1: Math.max(Math.floor(height * 0.15) + 1, Math.ceil(height * 0.91)) };
}

// image: { width, height, data: RGBA }. Returns { main, dark, light, busy, std } (colors as #rrggbb).
//   main   the strip's dominant color (the label color)
//   dark / light   the 3rd and 97th percentile pixels by brightness (robust to a stray speck)
//   busy   true when the brightness varies a lot across the strip
export function coverStats(image) {
  const { width, height, data } = image;
  const { x0, x1, y0, y1 } = stripRegion(width, height);
  const px = [];
  for (let y = y0; y < Math.min(y1, height); y++) {
    for (let x = x0; x < Math.min(x1, width); x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (px.length === 0) throw new Error('cover has no visible pixels');
  const flat = new Uint8Array(px.length * 4);
  px.forEach((p, k) => { flat[k * 4] = p[0]; flat[k * 4 + 1] = p[1]; flat[k * 4 + 2] = p[2]; flat[k * 4 + 3] = 255; });
  const main = rgbToHex(dominantColor({ data: flat }));
  const lums = px.map((p) => lum(...p));
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const std = Math.sqrt(lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length);
  const order = px.map((p, i) => i).sort((a, b) => lums[a] - lums[b]);
  const at = (q) => px[order[Math.min(order.length - 1, Math.max(0, Math.round((order.length - 1) * q)))]];
  return { main, dark: rgbToHex(at(0.03)), light: rgbToHex(at(0.97)), busy: std > BUSY_STD_DEV, std: Math.round(std * 10) / 10 };
}
