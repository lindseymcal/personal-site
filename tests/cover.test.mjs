import test from 'node:test';
import assert from 'node:assert/strict';
import { coverUrl, fetchCoverColor, fillColorCache } from '../src/cover.mjs';

const okResponse = (bytes = 400) => ({ status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(bytes) });
const status = (code) => ({ status: code, ok: code >= 200 && code < 300, arrayBuffer: async () => new ArrayBuffer(0) });

test('cover url asks for no placeholder image', () => {
  assert.equal(coverUrl('9780141439686'), 'https://covers.openlibrary.org/b/isbn/9780141439686-S.jpg?default=false');
});

test('fetchCoverColor: 404 means no cover; other failures are retryable errors', async () => {
  assert.deepEqual(await fetchCoverColor('1', { fetchImpl: async () => status(404) }), { status: 'none' });
  assert.equal((await fetchCoverColor('1', { fetchImpl: async () => status(503) })).status, 'error');
  assert.equal((await fetchCoverColor('1', { fetchImpl: async () => { throw new Error('offline'); } })).status, 'error');
});

test('fetchCoverColor: a tiny response is treated as no cover', async () => {
  assert.deepEqual(await fetchCoverColor('1', { fetchImpl: async () => okResponse(10) }), { status: 'none' });
});

test('fetchCoverColor: converts and returns a hex color; conversion failure is an error', async () => {
  // a 1-pixel red 24-bit BMP
  const bmp = Buffer.alloc(58);
  bmp.write('BM', 0); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22);
  bmp.writeUInt16LE(24, 28); bmp[56] = 0x30; bmp[55] = 0x30; bmp[54] = 0xc0; // b, g, r
  const ok = await fetchCoverColor('1', { fetchImpl: async () => okResponse(), toBmp: () => bmp });
  assert.equal(ok.status, 'ok');
  assert.match(ok.hex, /^#[0-9a-f]{6}$/);
  const bad = await fetchCoverColor('1', { fetchImpl: async () => okResponse(), toBmp: () => { throw new Error('no sips'); } });
  assert.deepEqual(bad, { status: 'error', message: 'no sips' });
});

test('fillColorCache only asks for ISBNs it has not seen', async () => {
  const asked = [];
  const fetchColor = async (isbn) => { asked.push(isbn); return isbn === 'B' ? { status: 'none' } : { status: 'ok', hex: '#112233' }; };
  const r = await fillColorCache(['A', 'B', 'C', 'A', ''], { C: '#abcdef' }, { fetchColor, pauseMs: 0 });
  assert.deepEqual(asked, ['A', 'B']);
  assert.deepEqual(r.cache, { A: '#112233', B: null, C: '#abcdef' });
  assert.equal(r.fetched, 2);
});

test('fillColorCache: errors are not cached, so the next build retries', async () => {
  const r = await fillColorCache(['A'], {}, { fetchColor: async () => ({ status: 'error', message: 'x' }), pauseMs: 0 });
  assert.deepEqual(r.cache, {});
  assert.equal(r.failed, 1);
});

test('fillColorCache: refresh retries missing covers; offline never fetches', async () => {
  const asked = [];
  const fetchColor = async (i) => { asked.push(i); return { status: 'ok', hex: '#000001' }; };
  await fillColorCache(['A', 'B'], { A: null, B: '#222222' }, { refresh: true, fetchColor, pauseMs: 0 });
  assert.deepEqual(asked, ['A']);
  asked.length = 0;
  const r = await fillColorCache(['Z'], {}, { offline: true, fetchColor, pauseMs: 0 });
  assert.deepEqual(asked, []);
  assert.equal(r.skipped, 1);
});
