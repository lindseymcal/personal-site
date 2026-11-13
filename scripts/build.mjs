#!/usr/bin/env node
// Builds the site's pages from your files. Run it from the repo root:
//
//   node scripts/build.mjs [path/to/goodreads_library_export.csv] [--offline] [--refresh-colors]
//
// With no path it reads ~/.agent-fleet/goodreads/goodreads_library_export.csv.
// Reads:  the CSV, site.config.json, content/books-extra.json, content/projects.json, content/spine-colors.json, writing/*.html
// Writes: index.html, books.html, writing.html, projects.html, projects/<name>.html, and content/spine-colors.json
// The only network use: Open Library cover colors for ISBNs not already in content/spine-colors.json.
// --offline skips even that (new books get a color picked from their title).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../src/build-site.mjs';
import { csvToObjects } from '../src/csv.mjs';
import { rowsToBooks } from '../src/books.mjs';
import { parseEssay } from '../src/site.mjs';
import { fillColorCache } from '../src/cover.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CSV = path.join(os.homedir(), '.agent-fleet', 'goodreads', 'goodreads_library_export.csv');

function readJson(rel, fallback) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${rel} is not valid JSON (${err.message}). Check for a missing comma or quote.`);
  }
}

function readEssays() {
  const dir = path.join(ROOT, 'writing');
  const essays = [];
  const problems = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!name.endsWith('.html') || name.startsWith('_')) continue;
    const e = parseEssay(fs.readFileSync(path.join(dir, name), 'utf8'), name);
    if (e.error) problems.push(e.error); else essays.push(e);
  }
  return { essays, problems };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const csvArg = args.find((a) => !a.startsWith('--'));
  const csvPath = path.resolve(csvArg ?? DEFAULT_CSV);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Can't find the Goodreads export at ${csvPath}\nExport it from Goodreads (My Books > Import and export), then pass its path: node scripts/build.mjs path/to/file.csv`);
  }
  const csvText = fs.readFileSync(csvPath, 'utf8');

  const extras = readJson('content/books-extra.json', {});
  const cache = readJson('content/spine-colors.json', {});
  const books = rowsToBooks(csvToObjects(csvText));
  console.log(`Read ${books.length} books from the "read" shelf.`);

  const filled = await fillColorCache(books.map((b) => b.isbn), cache, {
    refresh: flags.has('--refresh-colors'),
    offline: flags.has('--offline'),
    log: (m) => console.warn(m),
  });
  if (filled.fetched || filled.failed || filled.skipped) {
    console.log(`Cover colors: ${filled.fetched} looked up, ${filled.failed} failed (will retry next build), ${filled.skipped} skipped.`);
  }
  // Sorted keys keep the file's diffs small and tidy.
  const sortedCache = Object.fromEntries(Object.entries(filled.cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(path.join(ROOT, 'content/spine-colors.json'), JSON.stringify(sortedCache, null, 2) + '\n');

  const { essays, problems } = readEssays();
  const { pages, warnings } = buildPages({
    csvText,
    extras,
    colors: filled.cache,
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
