// Finding a book's color from its Open Library cover. This is the only code that touches the network
// (and it runs at BUILD time only; visitors never trigger it).
//
// How: download the small cover JPEG, let macOS `sips` turn it into a BMP, read the BMP ourselves.
// No npm dependencies. Everything that can fail returns a status instead of throwing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bmpDominantColor } from './bmp.mjs';
import { tuneCoverColor } from './spine.mjs';

export function coverUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-S.jpg?default=false`;
}

// JPEG bytes -> BMP bytes using macOS sips. Throws if sips is missing or fails.
export function jpegToBmp(jpegBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'));
  try {
    const jpg = path.join(dir, 'in.jpg');
    const bmp = path.join(dir, 'out.bmp');
    fs.writeFileSync(jpg, jpegBytes);
    execFileSync('sips', ['-s', 'format', 'bmp', jpg, '--out', bmp], { stdio: 'ignore', timeout: 20_000 });
    return fs.readFileSync(bmp);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Returns { status: 'ok', hex } | { status: 'none' } (no cover exists) | { status: 'error', message } (try again later).
export async function fetchCoverColor(isbn, { fetchImpl = globalThis.fetch, toBmp = jpegToBmp } = {}) {
  try {
    const res = await fetchImpl(coverUrl(isbn), { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    if (res.status === 404) return { status: 'none' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 300) return { status: 'none' }; // a placeholder pixel, not a real cover
    const hex = tuneCoverColor(bmpDominantColor(toBmp(bytes)));
    return { status: 'ok', hex };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// The cache file maps ISBN -> "#rrggbb" or null (checked, no cover). Returns it with unknown ISBNs filled in.
//   refresh: also retry the ISBNs that had no cover last time
//   offline: never touch the network
export async function fillColorCache(isbns, cache, { refresh = false, offline = false, fetchColor = fetchCoverColor, pauseMs = 150, log = () => {} } = {}) {
  const next = { ...cache };
  const wanted = [...new Set(isbns.filter(Boolean))].filter((i) => !(i in next) || (refresh && next[i] === null));
  if (offline || wanted.length === 0) return { cache: next, fetched: 0, failed: 0, skipped: offline ? wanted.length : 0 };
  let fetched = 0, failed = 0;
  for (const isbn of wanted) {
    const r = await fetchColor(isbn);
    if (r.status === 'ok') { next[isbn] = r.hex; fetched++; }
    else if (r.status === 'none') { next[isbn] = null; fetched++; }
    else { failed++; log(`could not fetch a cover color for ${isbn}: ${r.message}`); }
    if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
  }
  return { cache: next, fetched, failed, skipped: 0 };
}
