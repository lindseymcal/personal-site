// Read an uncompressed BMP (what macOS `sips -s format bmp` writes) and find a cover's main color.
// No dependencies. Supports 24-bit and 32-bit pixels.

// Returns { width, height, data } where data is RGBA bytes, top row first.
export function parseBmp(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('not a BMP file');
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  if (headerSize < 40) throw new Error('unsupported BMP header');
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0 && compression !== 3) throw new Error('compressed BMP not supported');
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP depth: ${bpp}`);
  if (width <= 0 || width > 4096 || rawHeight === 0 || Math.abs(rawHeight) > 4096) throw new Error('bad BMP size');

  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bytesPerPixel = bpp / 8;
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4; // rows are padded to 4 bytes
  if (dataOffset + stride * (height - 1) + width * bytesPerPixel > buf.length) throw new Error('truncated BMP');

  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = dataOffset + srcRow * stride + x * bytesPerPixel;
      const d = (y * width + x) * 4;
      data[d] = buf[s + 2];     // BMP stores blue, green, red
      data[d + 1] = buf[s + 1];
      data[d + 2] = buf[s];
      data[d + 3] = bytesPerPixel === 4 ? buf[s + 3] : 255;
    }
  }
  return { width, height, data };
}

// The main color of an RGBA image as [r, g, b].
// Plain average would turn most covers to mud and white margins to cream, so:
//  - near-white, near-black and see-through pixels are skipped (unless that is all there is)
//  - vivid pixels count more than gray ones
export function dominantColor({ data }) {
  let r = 0, g = 0, b = 0, w = 0;
  let ar = 0, ag = 0, ab = 0, an = 0; // plain average of everything, as a fallback
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i], pg = data[i + 1], pb = data[i + 2], pa = data[i + 3];
    if (pa < 128) continue;
    ar += pr; ag += pg; ab += pb; an++;
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
    if (min > 232) continue; // white margins
    if (max < 45) continue; // black borders and shadows (many covers are framed in black)
    const saturation = (max - min) / max;
    const weight = 1 + 8 * saturation * saturation;
    r += pr * weight; g += pg * weight; b += pb * weight; w += weight;
  }
  if (w > 0) return [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
  if (an > 0) return [Math.round(ar / an), Math.round(ag / an), Math.round(ab / an)];
  throw new Error('image has no visible pixels');
}

export function bmpDominantColor(buf) {
  return dominantColor(parseBmp(buf));
}
