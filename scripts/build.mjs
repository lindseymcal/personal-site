#!/usr/bin/env node
// Builds the site's pages from your files. Run it from the repo root. A CSV path is REQUIRED
// (so a build can never pick up your real Goodreads export by accident):
//
//   npm run build:sample     the fake sample books: use this for code, design and content changes
//   npm run build            your real export at ~/.agent-fleet/goodreads/goodreads_library_export.csv:
//                            only when you mean to publish your books
//   node scripts/build.mjs <file.csv> [--cache <file.json>] [--offline] [--refresh-colors]
//
// Reads:  the CSV, site.config.json, content/books-extra.json, content/projects.json, writing/*.html
// Writes: index.html, books.html, writing.html, projects.html, projects/<name>.html, the Substack link
//         inside each essay, and the cover-color cache.
// The cover-color cache (ISBN -> spine color) stays OUT of the repo: by default
// ~/.agent-fleet/goodreads/spine-colors.json. The sample build keeps its own in tests/fixtures/.
// It is pruned to the books in this build, so it never remembers books you removed.
// The only network use: Open Library cover colors for ISBNs not already cached. --offline skips that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { csvToObjects } from '../src/csv.mjs';
import { rowsToBooks } from '../src/books.mjs';
import { parseEssay, applyEssayFooter } from '../src/site.mjs';
import { essayFooterLink } from '../src/render.mjs';
import { fillColorCache, sipsAvailable } from '../src/cover.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// Reads the essays, and rewrites each essay's Substack link from its own essay-substack meta tag.
function readEssays() {
  const dir = path.join(ROOT, 'writing');
  const essays = [];
  const problems = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!name.endsWith('.html') || name.startsWith('_')) continue;
    const file = path.join(dir, name);
    const html = fs.readFileSync(file, 'utf8');
    const e = parseEssay(html, name);
    if (e.error) { problems.push(e.error); continue; }
    essays.push(e);
    if (e.substackUrl) {
      const out = applyEssayFooter(html, essayFooterLink(e.substackUrl));
      if (!out.found) problems.push(`writing/${name} has no substack-link markers around its footer link, so its essay-substack tag is not used there`);
      else if (out.html !== html) fs.writeFileSync(file, out.html);
    }
  }
  return { essays, problems };
}

async function main() {
  const args = process.argv.slice(2);
  const cacheAt = args.indexOf('--cache');
  const cacheArg = cacheAt >= 0 ? args[cacheAt + 1] : undefined;
  if (cacheAt >= 0 && (!cacheArg || cacheArg.startsWith('--'))) throw new Error('--cache needs a file path after it');
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const csvArg = args.find((a, i) => !a.startsWith('--') && (cacheAt < 0 || i !== cacheAt + 1));
  if (!csvArg) {
    throw new Error('Tell me which CSV to build from (this is on purpose, so your real export is never read by accident):\n  npm run build:sample   the fake sample books, for normal changes\n  npm run build          your real Goodreads export, only when you mean to publish your books');
  }
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Can't find the Goodreads export at ${csvPath}\nExport it from Goodreads (My Books > Import and export), then pass its path: node scripts/build.mjs path/to/file.csv`);
  }
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const cachePath = path.resolve(cacheArg ?? DEFAULT_CACHE);

  const extras = readJson('content/books-extra.json', {});
  const cache = readJson(cachePath, {});
  const books = rowsToBooks(csvToObjects(csvText));
  console.log(`Read ${books.length} books from the "read" shelf.`);

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
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(pruned, null, 2) + '\n', { mode: 0o600 });

  const { essays, problems } = readEssays();
  const { pages, warnings } = buildPages({
    csvText,
    extras,
    colors: pruned,
    configRaw: readJson('site.config.json', {}),
    projectsRaw: readJson('content/projects.json', []),
    essays,
  });

  fs.mkdirSync(path.join(ROOT, 'projects'), { recursive: true });
  // Remove old generated project pages whose project is gone.
  for (const f of fs.readdirSync(path.join(ROOT, 'projects'))) {
    if (f.endsWith('.html') && !(`projects/${f}` in pages)) fs.rmSync(path.join(ROOT, 'projects', f));
  }
  for (const [rel, html] of Object.entries(pages)) fs.writeFileSync(path.join(ROOT, rel), html);

  console.log(`Wrote ${Object.keys(pages).length} pages: ${Object.keys(pages).join(', ')}`);
  console.log(`Writing: ${essays.length} essays.`);
  for (const w of [...warnings, ...problems]) console.warn(`Warning: ${w}`);
}

main().catch((err) => {
  console.error(`Build stopped: ${err.message}`);
  process.exit(1);
});
