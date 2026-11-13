// Everything the build does except touching the disk or the network: inputs in, a map of
// "file path -> page text" out. scripts/build.mjs reads the files and writes this result.
import { csvToObjects, parseCsv } from './csv.mjs';
import { rowsToBooks, mergeExtra, groupByYear, unmatchedExtraIds, applyReviewPolicy, isHexColor } from './books.mjs';
import { normalizeConfig, normalizeProjects, groupEssaysByYear, splitYearsAcrossPages } from './site.mjs';
import { renderHome, renderBooks, renderWriting, renderProjects, renderProject } from './render.mjs';

// Cover stats come from a cache file, so check their shape before trusting them in a style attribute.
export function validCoverStats(s) {
  const hex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  return s && typeof s === 'object' && hex(s.main) && hex(s.dark) && hex(s.light) && typeof s.busy === 'boolean';
}

// covers (optional, the --covers preview only): { <isbn>: { main, dark, light, busy } } for books whose picture is available.
export function buildPages({ csvText, extras = {}, colors = {}, configRaw = {}, projectsRaw = [], essays = [], covers = {} }) {
  const warnings = [];
  const header = parseCsv(csvText)[0] ?? [];
  for (const col of ['Exclusive Shelf', 'Book Id']) {
    if (!header.map((h) => h.trim()).includes(col)) warnings.push(`the CSV has no "${col}" column: is this really a Goodreads library export?`);
  }
  const config = normalizeConfig(configRaw);
  if (configRaw && configRaw.reviews !== undefined && configRaw.reviews !== config.reviews) {
    warnings.push(`site.config.json: reviews must be exactly "all", "chosen" or "none" (got ${JSON.stringify(configRaw.reviews)}), so no reviews will be published`);
  }
  const projects = normalizeProjects(projectsRaw);
  const books = rowsToBooks(csvToObjects(csvText)).map((b) => applyReviewPolicy(mergeExtra(b, extras), config.reviews, extras));
  const badColors = new Set();
  const colorFor = (b) => {
    const c = b.isbn ? colors[b.isbn] : undefined;
    if (c == null) return undefined;
    if (isHexColor(c)) return c;
    badColors.add(b.isbn);
    return undefined;
  };
  const essayGroups = groupEssaysByYear(essays);
  const newest = essayGroups[0]?.essays[0];

  const pages = {
    'index.html': renderHome({ config, books, colorFor, projects, notebookTitle: newest?.title ?? '' }),
    'books.html': renderBooks({ config, groups: groupByYear(books), colorFor, coverStatsFor: (b) => (b.isbn && Object.hasOwn(covers, b.isbn) && validCoverStats(covers[b.isbn]) ? covers[b.isbn] : undefined) }),
    'writing.html': renderWriting({ config, groups: essayGroups, splitPages: splitYearsAcrossPages }),
    'projects.html': renderProjects({ config, projects }),
  };
  for (const project of projects) pages[`projects/${project.slug}.html`] = renderProject({ config, project });

  for (const isbn of badColors) warnings.push(`the cover-color cache has a bad color for ISBN ${isbn}; using a color from the title instead`);
  warnings.push(...unmatchedExtraIds(books, extras).map((id) => `books-extra.json has "${id}" but no book on your read shelf has that Book Id`));
  return { pages, books, warnings };
}
