// Everything the build does except touching the disk or the network: inputs in, a map of
// "file path -> page text" out. scripts/build.mjs reads the files and writes this result.
import { csvToObjects } from './csv.mjs';
import { rowsToBooks, mergeExtra, groupByYear, unmatchedExtraIds } from './books.mjs';
import { normalizeConfig, normalizeProjects, groupEssaysByYear, splitYearsAcrossPages } from './site.mjs';
import { renderHome, renderBooks, renderWriting, renderProjects, renderProject } from './render.mjs';

export function buildPages({ csvText, extras = {}, colors = {}, configRaw = {}, projectsRaw = [], essays = [] }) {
  const config = normalizeConfig(configRaw);
  const projects = normalizeProjects(projectsRaw);
  const books = rowsToBooks(csvToObjects(csvText)).map((b) => mergeExtra(b, extras));
  const colorFor = (b) => (b.isbn && typeof colors[b.isbn] === 'string' ? colors[b.isbn] : undefined);
  const essayGroups = groupEssaysByYear(essays);
  const newest = essayGroups[0]?.essays[0];

  const pages = {
    'index.html': renderHome({ config, books, colorFor, projects, notebookTitle: newest?.title ?? '' }),
    'books.html': renderBooks({ config, groups: groupByYear(books), colorFor }),
    'writing.html': renderWriting({ config, groups: essayGroups, splitPages: splitYearsAcrossPages }),
    'projects.html': renderProjects({ config, projects }),
  };
  for (const project of projects) pages[`projects/${project.slug}.html`] = renderProject({ config, project });

  return { pages, books, warnings: unmatchedExtraIds(books, extras).map((id) => `books-extra.json has "${id}" but no book on your read shelf has that Book Id`) };
}
