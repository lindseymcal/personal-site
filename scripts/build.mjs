#!/usr/bin/env node
// Builds the site's pages from your files. Run it from the repo root. A CSV path is REQUIRED
// (so a build can never pick up your real Goodreads export by accident):
//
//   npm run build           YOUR real export (~/.agent-fleet/goodreads/goodreads_library_export.csv).
//                           Rewrites the real pages. Run this after ANY change you want on the site
//                           (books, links, essays, projects).
//   npm run build:sample    a PREVIEW of the whole site from the fake sample books, written to the
//                           git-ignored preview/ folder. Touches nothing else. For code and design work.
//   node scripts/build.mjs <file.csv> [--cache <file>] [--cache-seed <file>] [--out <folder>]
//                          [--offline] [--refresh-colors] [--allow-empty] [--prune]
//
// Reads:  the CSV, site.config.json, content/books-extra.json, content/projects.json, writing/*.html
// Writes: index.html, books.html, writing.html, projects.html, projects/<name>.html and the Substack
//         link inside each essay (all into --out, default the repo itself), plus the cover-color cache.
//
// Cover-color cache (ISBN -> spine color), kept OUT of the repo:
//   - for your real export it is ~/.agent-fleet/goodreads/spine-colors.json
//   - for any other CSV you must say where with --cache (the preview build uses preview/spine-colors.json,
//     seeded from tests/fixtures/sample-spine-colors.json with --cache-seed)
//   - it is pruned to the books in this build; if that would drop more than half of it, the build stops
//     unless you pass --prune.
// Safety stops (nothing is written): the CSV lacks the Goodreads columns or holds 0 read books
// (wrong file?) unless --allow-empty.
// The only network use: Open Library cover colors for ISBNs not already cached. --offline skips that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { csvToObjects, parseCsv } from '../src/csv.mjs';
import { rowsToBooks } from '../src/books.mjs';
import { parseEssay, applyEssayFooter } from '../src/site.mjs';
import { essayFooterLink } from '../src/render.mjs';
import { fillColorCache, sipsAvailable } from '../src/cover.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CSV = path.join(os.homedir(), '.agent-fleet', 'goodreads', 'goodreads_library_export.csv');
const DEFAULT_CACHE = path.join(os.homedir(), '.agent-fleet', 'goodreads', 'spine-colors.json');

function readJson(rel, fallback) {
  const file = path.resolve(ROOT, rel);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${rel} is not valid JSON (${err.message}). Check for a missing comma or quote.`);
  }
}

// Reads the essays and regenerates each essay's Substack link from its own essay-substack meta tag.
// outDir is where the result goes: the repo itself (essay files are rewritten in place) or a preview folder
// (copies are written there and the real essay files are never touched).
function readEssays(outDir) {
  const dir = path.join(ROOT, 'writing');
  const inPlace = outDir === ROOT;
  const essays = [];
  const problems = [];
  if (!inPlace) fs.mkdirSync(path.join(outDir, 'writing'), { recursive: true });
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!name.endsWith('.html') || name.startsWith('_')) continue;
    const html = fs.readFileSync(path.join(dir, name), 'utf8');
    const e = parseEssay(html, name);
    if (e.error) { problems.push(e.error); continue; }
    essays.push(e);
    let result = html;
    if (e.substackRejected) {
      problems.push(`writing/${name}: essay-substack is not a usable web address (it must start with https://), so the footer link was left alone`);
    } else if (e.substackUrl) {
      const out = applyEssayFooter(html, essayFooterLink(e.substackUrl));
      if (out.ok) result = out.html;
      else problems.push(`writing/${name}: footer link left untouched (${out.reason})`);
    }
    if (inPlace) { if (result !== html) fs.writeFileSync(path.join(dir, name), result); }
    else fs.writeFileSync(path.join(outDir, 'writing', name), result);
  }
  return { essays, problems };
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
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Can't find the Goodreads export at ${csvPath}\nExport it from Goodreads (My Books > Import and export), then pass its path: node scripts/build.mjs path/to/file.csv`);
  }
  // The default cache belongs to the real export only. Any other CSV must say where its cache goes.
  const isRealCsv = csvPath === DEFAULT_CSV;
  if (!values['--cache'] && !isRealCsv) {
    throw new Error('This CSV is not your real export, so I will not use your real color cache. Add --cache <file> (npm run build:sample does this for you).');
  }
  const cachePath = path.resolve(values['--cache'] ?? DEFAULT_CACHE);
  const outDir = path.resolve(values['--out'] ?? ROOT);
  const csvText = fs.readFileSync(csvPath, 'utf8');

  // Stop before writing anything if this does not look like a Goodreads library export.
  const header = (parseCsv(csvText)[0] ?? []).map((h) => h.trim());
  const missing = ['Exclusive Shelf', 'Book Id'].filter((c) => !header.includes(c));
  if (missing.length && !flags.has('--allow-empty')) {
    throw new Error(`The CSV has no "${missing.join('" or "')}" column, so it does not look like a Goodreads library export (wrong file?). Nothing was changed. Pass --allow-empty to build anyway.`);
  }

  const extras = readJson('content/books-extra.json', {});
  let cache = readJson(cachePath, null);
  if (cache === null && values['--cache-seed']) cache = readJson(values['--cache-seed'], {});
  cache = cache ?? {};
  const books = rowsToBooks(csvToObjects(csvText));
  console.log(`Read ${books.length} books from the "read" shelf.`);
  if (books.length === 0 && !flags.has('--allow-empty')) {
    throw new Error('No books on the "read" shelf were found in that CSV (wrong file, or an empty library?). Nothing was changed. Pass --allow-empty to build anyway.');
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
    throw new Error(`This build would forget ${dropped} of the ${Object.keys(cache).length} cached cover colors (a different or damaged CSV?). Nothing was changed. Pass --prune if that is what you want.`);
  }

  // ---- from here on we write (everything above only reads) ----
  const { essays, problems } = readEssays(outDir);
  const { pages, warnings } = buildPages({
    csvText,
    extras,
    colors: pruned,
    configRaw: readJson('site.config.json', {}),
    projectsRaw: readJson('content/projects.json', []),
    essays,
  });

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(pruned, null, 2) + '\n', { mode: 0o600 });

  if (outDir !== ROOT) fs.cpSync(path.join(ROOT, 'assets'), path.join(outDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'projects'), { recursive: true });
  // Remove old generated project pages whose project is gone.
  for (const f of fs.readdirSync(path.join(outDir, 'projects'))) {
    if (f.endsWith('.html') && !(`projects/${f}` in pages)) fs.rmSync(path.join(outDir, 'projects', f));
  }
  for (const [rel, html] of Object.entries(pages)) fs.writeFileSync(path.join(outDir, rel), html);
  if (outDir !== ROOT) console.log(`Preview written to ${path.relative(ROOT, outDir) || outDir}/ (open its index.html). No real pages were touched.`);

  console.log(`Wrote ${Object.keys(pages).length} pages: ${Object.keys(pages).join(', ')}`);
  console.log(`Writing: ${essays.length} essays.`);
  for (const w of [...warnings, ...problems]) console.warn(`Warning: ${w}`);
}

main().catch((err) => {
  console.error(`Build stopped: ${err.message}`);
  process.exit(1);
});
