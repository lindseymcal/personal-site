import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBmp, dominantColor, bmpDominantColor } from '../src/bmp.mjs';

// Builds a BMP in memory. pixels is rows of [r,g,b] (or [r,g,b,a] for 32-bit), top row first.
function makeBmp(pixels, { bpp = 24, topDown = false } = {}) {
  const height = pixels.length;
  const width = pixels[0].length;
  const bytes = bpp / 8;
  const stride = Math.ceil((width * bytes) / 4) * 4;
  const buf = Buffer.alloc(54 + stride * height);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(topDown ? -height : height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bpp, 28);
  buf.writeUInt32LE(0, 30);
  for (let y = 0; y < height; y++) {
    const row = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixels[y][x];
      const o = 54 + row * stride + x * bytes;
      buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
      if (bytes === 4) buf[o + 3] = a;
    }
  }
  return buf;
}

test('reads 24-bit bottom-up pixels in the right order (with row padding)', () => {
  const img = [[[255, 0, 0], [0, 255, 0], [0, 0, 255]], [[10, 20, 30], [40, 50, 60], [70, 80, 90]]]; // width 3 => padded rows
  const { width, height, data } = parseBmp(makeBmp(img));
  assert.deepEqual([width, height], [3, 2]);
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 255]);
  assert.deepEqual([...data.slice(12, 16)], [10, 20, 30, 255]);
});

test('reads top-down and 32-bit images', () => {
  const img = [[[1, 2, 3, 255], [4, 5, 6, 128]], [[7, 8, 9, 255], [10, 11, 12, 255]]];
  const { data } = parseBmp(makeBmp(img, { bpp: 32, topDown: true }));
  assert.deepEqual([...data.slice(0, 4)], [1, 2, 3, 255]);
  assert.deepEqual([...data.slice(4, 8)], [4, 5, 6, 128]);
  assert.deepEqual([...data.slice(8, 12)], [7, 8, 9, 255]);
});

test('rejects things that are not usable BMPs', () => {
  assert.throws(() => parseBmp(Buffer.from('not a bmp at all, just text that is long enough to pass the size check....')), /not a BMP/);
  const bad = makeBmp([[[0, 0, 0]]]);
  bad.writeUInt16LE(8, 28);
  assert.throws(() => parseBmp(bad), /depth/);
  const compressed = makeBmp([[[0, 0, 0]]]);
  compressed.writeUInt32LE(1, 30);
  assert.throws(() => parseBmp(compressed), /compressed/);
  assert.throws(() => parseBmp(makeBmp([[[0, 0, 0]]]).subarray(0, 56)), /truncated/);
});

test('dominantColor of a flat image is that color', () => {
  const img = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => [120, 60, 40]));
  assert.deepEqual(bmpDominantColor(makeBmp(img)), [120, 60, 40]);
});

test('white margins and black borders are ignored', () => {
  const px = [];
  for (let i = 0; i < 20; i++) px.push([255, 255, 255, 255, 255, 255]);
  const rgba = (list) => ({ data: Uint8Array.from(list.flatMap(([r, g, b]) => [r, g, b, 255])) });
  const img = rgba([...Array(10).fill([250, 250, 250]), ...Array(10).fill([5, 5, 5]), ...Array(4).fill([200, 40, 40])]);
  assert.deepEqual(dominantColor(img), [200, 40, 40]);
});

test('vivid pixels outweigh gray ones', () => {
  const rgba = (list) => ({ data: Uint8Array.from(list.flatMap(([r, g, b]) => [r, g, b, 255])) });
  const [r, g, b] = dominantColor(rgba([...Array(4).fill([120, 120, 120]), ...Array(4).fill([200, 20, 20])]));
  assert.ok(r > 150 && g < 100 && b < 100, `got ${r},${g},${b}`);
});

test('an all-white image falls back to the plain average, and an empty one throws', () => {
  const white = { data: Uint8Array.from([255, 255, 255, 255, 250, 250, 250, 255]) };
  assert.deepEqual(dominantColor(white), [253, 253, 253]);
  assert.throws(() => dominantColor({ data: Uint8Array.from([1, 2, 3, 0]) }), /no visible pixels/);
});
