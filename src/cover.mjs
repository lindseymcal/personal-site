// Finding a book's color from its Open Library cover. This is the only code that touches the network
// (and it runs at BUILD time only; visitors never trigger it).
//
// How: download the small cover JPEG, let macOS `sips` turn it into a BMP, read the BMP ourselves.
// No npm dependencies. Everything that can fail returns a status instead of throwing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
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

const MAX_COVER_BYTES = 1_000_000;
const ALLOWED_HOST = /(^|\.)(openlibrary|archive)\.org$/i;

// Is macOS `sips` installed? Checked once per build so a missing tool does not cause repeated downloads.
export function sipsAvailable(run = spawnSync) {
  const r = run('sips', ['--version'], { stdio: 'ignore' });
  return !r.error;
}

// Downloads one image with every safety check: the final address (after redirects) must be on
// openlibrary.org or archive.org, the response must be an image, and it must be under about 1 MB.
// Returns { status: 'ok', bytes } | { status: 'none' } (no cover exists) | { status: 'error', message } (try again later).
async function downloadChecked(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
  if (res.status === 404) return { status: 'none' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
  if (res.url && !ALLOWED_HOST.test(new URL(res.url).hostname)) return { status: 'error', message: `unexpected host ${new URL(res.url).hostname}` };
  const type = res.headers?.get?.('content-type');
  if (type && !/^image\//i.test(type)) return { status: 'error', message: `not an image (${type})` };
  const declared = Number(res.headers?.get?.('content-length'));
  if (declared > MAX_COVER_BYTES) return { status: 'error', message: 'cover file is too large' };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) return { status: 'error', message: 'cover file is too large' };
  if (bytes.length < 300) return { status: 'none' }; // a placeholder pixel, not a real cover
  return { status: 'ok', bytes };
}

// Returns { status: 'ok', hex } | { status: 'none' } | { status: 'error', message }.
export async function fetchCoverColor(isbn, { fetchImpl = globalThis.fetch, toBmp = jpegToBmp } = {}) {
  try {
    const got = await downloadChecked(coverUrl(isbn), fetchImpl);
    if (got.status !== 'ok') return got;
    return { status: 'ok', hex: tuneCoverColor(bmpDominantColor(toBmp(got.bytes))) };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// ---- real cover pictures (the --covers preview only) ----
export function coverImageUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg?default=false`;
}
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const ISBN_RE = /^(\d{9}[\dX]|\d{13})$/;

// Same checks as the color lookup, plus: it must really be a JPEG (checked by its first bytes).
export async function fetchCoverImage(isbn, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const got = await downloadChecked(coverImageUrl(isbn), fetchImpl);
    if (got.status !== 'ok') return got;
    if (!isJpeg(got.bytes)) return { status: 'error', message: 'not a JPEG file' };
    return got;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// Keeps downloaded covers in a folder OUTSIDE the repo (dir mode 0700, files 0600): <isbn>.jpg for a
// cover, <isbn>.none for "checked, no cover", <isbn>.json for the label stats. Already-cached ISBNs are skipped.
// analyze(bytes) -> stats object (or throws). Returns { have: Map(isbn -> stats), found, none, failed, newBytes, totalBytes }.
export async function fillCoverFolder(isbns, dir, { offline = false, fetchImage = fetchCoverImage, analyze, pauseMs = 120, log = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const have = new Map();
  let found = 0, none = 0, failed = 0, newBytes = 0, totalBytes = 0;
  const write = (file, data) => { fs.writeFileSync(file, data, { mode: 0o600 }); fs.chmodSync(file, 0o600); };
  for (const isbn of [...new Set(isbns.filter((i) => ISBN_RE.test(i)))]) {
    const jpg = path.join(dir, `${isbn}.jpg`);
    const info = path.join(dir, `${isbn}.json`);
    const marker = path.join(dir, `${isbn}.none`);
    if (!fs.existsSync(jpg) && !fs.existsSync(marker) && !offline) {
      const r = await fetchImage(isbn);
      if (r.status === 'ok') { write(jpg, r.bytes); newBytes += r.bytes.length; }
      else if (r.status === 'none') write(marker, '');
      else { failed++; log(`could not download the cover for ${isbn}: ${r.message}`); }
      if (pauseMs) await new Promise((res) => setTimeout(res, pauseMs));
    }
    if (fs.existsSync(marker)) { none++; continue; }
    if (!fs.existsSync(jpg)) continue;
    totalBytes += fs.statSync(jpg).size;
    let stats = null;
    if (fs.existsSync(info)) { try { stats = JSON.parse(fs.readFileSync(info, 'utf8')); } catch { stats = null; } }
    if (!stats && analyze) {
      try { stats = analyze(fs.readFileSync(jpg)); write(info, JSON.stringify(stats)); } catch (err) { log(`could not read the cover for ${isbn}: ${err.message}`); }
    }
    if (stats) { have.set(isbn, stats); found++; }
  }
  return { have, found, none, failed, newBytes, totalBytes };
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
