#!/usr/bin/env node
// Builds the site's pages from your files. Run it from the repo root. A CSV path is REQUIRED
// (so a build can never pick up your real Goodreads export by accident).
//
//   npm run build            YOUR real export (~/.agent-fleet/goodreads/goodreads_library_export.csv).
//                            Writes the COMPLETE site (pages, assets, fonts, pictures, résumé) into the
//                            git-ignored site/ folder: preview it at site/index.html. Run it after ANY change
//                            you want on the site (books, links, essays, projects). It never writes the repo root.
//   npm run build:sample     a PREVIEW of the whole site from the fake sample books, into the git-ignored preview/.
//   npm run refresh:sample   the ONLY thing that writes the repo root: refreshes the committed sample pages
//                            (index.html, books.html, ...) from the fake sample CSV. Refused for any other CSV.
//   node scripts/build.mjs <file.csv> [--cache <file>] [--cache-seed <file>] [--out <folder>] [--root]
//                          [--offline] [--refresh-colors] [--allow-empty] [--prune] [--covers]
//   npm run preview:covers   EXPERIMENT: your real books with real cover pictures, into preview/ only (see --covers)
//
// Where output may go: --out must be site/ or preview/ (or a folder inside); with no --out it is site/.
// The repo root is only written with --root, and only when the CSV is the fake sample in tests/fixtures/.
//
// Reads:  the CSV, site.config.json, content/books-extra.json, content/projects.json, the Substack feed
//         (content/substack-feed.json is the saved copy for offline builds)
// Writes: index.html, books.html, writing.html, projects.html, projects/<name>.html (and, outside the root, a copy of
//         assets/) into the output folder, plus the cover-color cache and (not for previews) content/substack-feed.json.
//
// Cover-color cache (ISBN -> spine color), kept OUT of the repo:
//   - for your real export it is ~/.agent-fleet/goodreads/spine-colors.json
//   - for any other CSV you must say where with --cache (the preview build uses preview/spine-colors.json,
//     seeded from tests/fixtures/sample-spine-colors.json with --cache-seed)
//   - it is pruned to the books in this build; if that would drop more than half of it, the build stops
//     unless you pass --prune.
// --covers (opt-in, preview only): downloads each book's Open Library cover (medium size) into a folder OUTSIDE
// the repo, ~/.agent-fleet/goodreads/covers/ (dir 0700, files 0600), and draws spines cut from the covers.
// It only works together with --out preview: the pictures are copied into the git-ignored preview/ folder,
// never into the real site, because republishing cover images is Zee's decision.
// Safety stops (nothing is written): the CSV lacks the Goodreads columns or holds 0 read books
// (wrong file?) unless --allow-empty.
// The only network use: Open Library cover colors for ISBNs not already cached (--offline skips that) and the
// one Substack feed request (--offline skips that too).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { csvToObjects, parseCsv } from '../src/csv.mjs';
import { rowsToBooks } from '../src/books.mjs';
import { normalizeConfig } from '../src/site.mjs';
import { fetchFeed, parseFeed, readFeedCache, feedCacheObject } from '../src/feed.mjs';
import { fillColorCache, sipsAvailable, fillCoverFolder, jpegToBmp } from '../src/cover.mjs';
import { parseBmp } from '../src/bmp.mjs';
import { coverStats } from '../src/coverstats.mjs';

const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const DEFAULT_CSV = path.join(os.homedir(), '.agent-fleet', 'goodreads', 'goodreads_library_export.csv');
const DEFAULT_CACHE = path.join(os.homedir(), '.agent-fleet', 'goodreads', 'spine-colors.json');

// A path with symlinks resolved, even if the file does not exist yet (the nearest existing folder is resolved).
function realish(p) {
  const abs = path.resolve(p);
  const tail = [];
  let cur = abs;
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { tail.unshift(path.basename(cur)); cur = path.dirname(cur); }
  return path.join(fs.realpathSync(cur), ...tail);
}

function readJson(rel, fallback) {
  const file = path.resolve(ROOT, rel);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${rel} is not valid JSON (${err.message}). Check for a missing comma or quote.`);
  }
}

// Essays come from the Substack feed (one request). The last good copy is kept in content/substack-feed.json
// (her public writing, fine to commit) so offline builds, and builds when Substack is down, still work.
// A preview build (--out) reads the cache and may fetch, but never rewrites the cache file.
async function loadEssays({ feedUrl, offline, writeCache }) {
  const cacheRel = 'content/substack-feed.json';
  const extraHosts = feedUrl ? [new URL(feedUrl).hostname] : [];
  const cached = readFeedCache(readJson(cacheRel, null), extraHosts);
  const problems = [];
  if (!feedUrl) return { essays: cached, problems, source: 'cache (no substackFeedUrl in site.config.json)' };
  if (offline) return { essays: cached, problems, source: 'cache (offline)' };
  const got = await fetchFeed(feedUrl, { extraHosts });
  if (got.status === 'ok') {
    const entries = parseFeed(got.xml, extraHosts);
    if (entries.length > 0) {
      if (writeCache) {
        const next = JSON.stringify(feedCacheObject(feedUrl, entries), null, 2) + '\n';
        const file = path.join(ROOT, cacheRel);
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== next) fs.writeFileSync(file, next);
      }
      return { essays: entries, problems, source: `Substack feed ${feedUrl}` };
    }
    problems.push('the Substack feed had no usable posts; using the saved copy');
  } else {
    problems.push(`could not read the Substack feed (${got.message}); using the saved copy`);
  }
  return { essays: cached, problems, source: 'saved copy' };
}

// Splits "--name value" options from flags and the CSV path.
function parseArgs(args) {
  const values = {};
  const rest = [];
  const flags = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['--cache', '--cache-seed', '--out'].includes(a)) {
      const v = args[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a path after it`);
      values[a] = v; i++;
    } else if (a.startsWith('--')) flags.add(a);
    else rest.push(a);
  }
  return { values, flags, csvArg: rest[0] };
}

async function main() {
  const { values, flags, csvArg } = parseArgs(process.argv.slice(2));
  if (!csvArg) {
    throw new Error('Tell me which CSV to build from (this is on purpose, so your real export is never read by accident):\n  npm run build          your real Goodreads export: rewrites the real pages\n  npm run build:sample   a preview from the fake sample books, written to preview/');
  }
  const within = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  const previewDir = path.join(ROOT, 'preview');
  const siteDir = path.join(ROOT, 'site');
  if (flags.has('--covers') && !(values['--out'] && within(realish(values['--out']), previewDir))) {
    throw new Error('--covers only works together with --out preview (cover pictures are never put in the real site). Try: npm run preview:covers. Nothing was changed.');
  }
  const csvPath = realish(csvArg);
  // Exports hold private notes, so they may not sit inside the repo (only the fake sample may).
  const insideRepo = (() => { const r = path.relative(ROOT, csvPath); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); })();
  const insideFixtures = (() => { const r = path.relative(path.join(ROOT, 'tests', 'fixtures'), csvPath); return !r.startsWith('..') && !path.isAbsolute(r); })();
  if (insideRepo && !insideFixtures && csvPath !== realish(DEFAULT_CSV)) {
    throw new Error(`That CSV is inside the repo (${csvPath}). Keep Goodreads exports in ~/.agent-fleet/goodreads/ so they can never be committed. Nothing was changed.`);
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Can't find the Goodreads export at ${csvPath}\nExport it from Goodreads (My Books > Import and export), then pass its path: node scripts/build.mjs path/to/file.csv`);
  }
  // The default cache belongs to the real export only. Any other CSV must say where its cache goes.
  const isRealCsv = csvPath === realish(DEFAULT_CSV);
  if (!values['--cache'] && !isRealCsv) {
    throw new Error('This CSV is not your real export, so I will not use your real color cache. Add --cache <file> (npm run build:sample does this for you).');
  }
  const cachePath = realish(values['--cache'] ?? DEFAULT_CACHE);
  // Where files may go. A typo can never overwrite other folders: --out must be site/ or preview/ (or inside one),
  // and the repo root is written only by the sample refresh (--root with the fake sample CSV).
  // A cache may not live inside the repo (except in preview/), so ISBNs are never committed.
  let outDir;
  if (flags.has('--root')) {
    if (!insideFixtures) throw new Error('The repo root is only written by the sample refresh (npm run refresh:sample, with the fake sample CSV), never from a real export. Use npm run build: it writes site/. Nothing was changed.');
    if (values['--out']) throw new Error('--root and --out cannot be used together. Nothing was changed.');
    outDir = ROOT;
  } else {
    outDir = realish(values['--out'] ?? siteDir);
    if (!within(outDir, siteDir) && !within(outDir, previewDir)) {
      throw new Error(`--out may only be the site folder or the preview folder (or a folder inside one): ${siteDir} or ${previewDir}\nNothing was changed.`);
    }
  }
  const isPreview = within(outDir, previewDir);
  if (within(cachePath, ROOT) && !within(cachePath, previewDir) && cachePath !== realish(DEFAULT_CACHE)) {
    throw new Error(`The color cache must not be inside the repo (except in preview/), so your ISBNs are never committed: ${cachePath}\nNothing was changed.`);
  }
  const csvText = fs.readFileSync(csvPath, 'utf8');

  // Stop before writing anything if this does not look like a Goodreads library export.
  const header = (parseCsv(csvText)[0] ?? []).map((h) => h.trim());
  const missing = ['Exclusive Shelf', 'Book Id'].filter((c) => !header.includes(c));
  if (missing.length && !flags.has('--allow-empty')) {
    throw new Error(`The CSV has no "${missing.join('" or "')}" column, so it does not look like a Goodreads library export (wrong file?). Nothing was changed. Pass --allow-empty to build anyway (with npm: npm run build -- --allow-empty).`);
  }

  const extras = readJson('content/books-extra.json', {});
  let cache = readJson(cachePath, null);
  if (cache === null && values['--cache-seed']) cache = readJson(values['--cache-seed'], {});
  cache = cache ?? {};
  const books = rowsToBooks(csvToObjects(csvText));
  console.log(`Read ${books.length} books from the "read" shelf.`);
  if (books.length === 0 && !flags.has('--allow-empty')) {
    throw new Error('No books on the "read" shelf were found in that CSV (wrong file, or an empty library?). Nothing was changed. Pass --allow-empty to build anyway (with npm: npm run build -- --allow-empty).');
  }

  let offline = flags.has('--offline');
  if (!offline && !sipsAvailable()) {
    console.warn('Note: the macOS tool "sips" was not found, so cover colors are skipped; spines get a color from the book title.');
    offline = true;
  }
  const filled = await fillColorCache(books.map((b) => b.isbn), cache, {
    refresh: flags.has('--refresh-colors'),
    offline,
    log: (m) => console.warn(m),
  });
  if (filled.fetched || filled.failed || filled.skipped) {
    console.log(`Cover colors: ${filled.fetched} looked up, ${filled.failed} failed (will retry next build), ${filled.skipped} skipped.`);
  }
  // Keep only the books in this build (and sort the keys), so the cache never remembers removed books.
  const current = new Set(books.map((b) => b.isbn).filter(Boolean));
  const pruned = Object.fromEntries(Object.entries(filled.cache).filter(([isbn]) => current.has(isbn)).sort(([a], [b]) => a.localeCompare(b)));
  const dropped = Object.keys(cache).filter((isbn) => !(isbn in pruned)).length;
  if (dropped > 0 && dropped > Object.keys(cache).length / 2 && !flags.has('--prune')) {
    throw new Error(`This build would forget ${dropped} of the ${Object.keys(cache).length} cached cover colors (a different or damaged CSV?). Nothing was changed. Pass --prune if that is what you want (with npm: npm run build -- --prune).`);
  }

  // Cover pictures (preview only). Downloads go to the private folder outside the repo.
  let covers = {};
  let coverFiles = [];
  if (flags.has('--covers')) {
    const coversDir = path.join(os.homedir(), '.agent-fleet', 'goodreads', 'covers');
    const canAnalyze = sipsAvailable();
    if (!canAnalyze) console.warn('Note: "sips" was not found, so covers cannot be read; spines stay generated.');
    const got = await fillCoverFolder(books.map((b) => b.isbn), coversDir, {
      offline: flags.has('--offline'),
      analyze: canAnalyze ? (bytes) => coverStats(parseBmp(jpegToBmp(bytes))) : undefined,
      log: (m) => console.warn(m),
    });
    covers = Object.fromEntries(got.have);
    coverFiles = [...got.have.keys()].map((isbn) => ({ isbn, from: path.join(coversDir, `${isbn}.jpg`) }));
    const mb = (n) => (n / 1048576).toFixed(1);
    console.log(`Covers: ${got.found} found, ${got.none} have no cover on Open Library, ${got.failed} failed. Downloaded ${mb(got.newBytes)} MB this time; ${mb(got.totalBytes)} MB in the cache (${coversDir}).`);
  }

  // ---- from here on we write (everything above only reads) ----
  const config = normalizeConfig(readJson('site.config.json', {}));
  const { essays, problems, source } = await loadEssays({ feedUrl: config.substackFeedUrl, offline: flags.has('--offline'), writeCache: !isPreview });
  const { pages, warnings } = buildPages({
    csvText,
    extras,
    colors: pruned,
    configRaw: readJson('site.config.json', {}),
    projectsRaw: readJson('content/projects.json', []),
    essays,
    covers,
  });

  // Cover pictures go only into the preview folder (and are removed from it when --covers is not used).
  if (outDir !== ROOT) {
    fs.rmSync(path.join(outDir, 'covers'), { recursive: true, force: true });
    if (coverFiles.length) {
      fs.mkdirSync(path.join(outDir, 'covers'), { recursive: true });
      for (const f of coverFiles) fs.copyFileSync(f.from, path.join(outDir, 'covers', `${f.isbn}.jpg`));
    }
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(pruned, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(cachePath, 0o600); // the mode above only applies to a NEW file, so set it on every write

  // site/ is rebuilt from scratch so nothing stale is ever deployed; a deployable site needs its assets too
  if (outDir === siteDir) fs.rmSync(siteDir, { recursive: true, force: true });
  if (outDir !== ROOT) fs.cpSync(path.join(ROOT, 'assets'), path.join(outDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'projects'), { recursive: true });
  // Remove old generated project pages whose project is gone.
  for (const f of fs.readdirSync(path.join(outDir, 'projects'))) {
    if (f.endsWith('.html') && !(`projects/${f}` in pages)) fs.rmSync(path.join(outDir, 'projects', f));
  }
  for (const [rel, html] of Object.entries(pages)) fs.writeFileSync(path.join(outDir, rel), html);
  if (isPreview) console.log(`Preview written to ${path.relative(ROOT, outDir)}/ (open its index.html). Nothing else was touched.`);
  else if (outDir === ROOT) console.log('Sample pages refreshed in the repo root (these are committed; they come from the fake sample books).');
  else console.log(`Site written to ${path.relative(ROOT, outDir)}/ (open ${path.relative(ROOT, outDir)}/index.html). The repo root was not touched.`);

  console.log(`Wrote ${Object.keys(pages).length} pages: ${Object.keys(pages).join(', ')}`);
  console.log(`Writing: ${essays.length} essays from the ${source}.`);
  for (const w of [...warnings, ...problems]) console.warn(`Warning: ${w}`);
}

main().catch((err) => {
  console.error(`Build stopped: ${err.message}`);
  process.exit(1);
});
