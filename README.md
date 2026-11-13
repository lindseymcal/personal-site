# Personal site

A lamplit study. Each object in the room is the way into one part of the site. Plain HTML and CSS, no framework, nothing to install.

- **Look at it:** `npm run serve`, then open http://127.0.0.1:8080 (or just open `index.html` in a browser).
- **Tests:** `npm test`
- **Rebuild after changes:** `npm run build:sample` (the fake sample books). Use this for normal changes. `npm run build` is the one that uses your real Goodreads export, so run it only when you mean to publish your books. The build always needs a CSV path and refuses to run without one.
- **Design reference:** `docs/design/index.html` (the designer's mockups and the decisions behind them)

Nothing here is published. There is no remote; hosting is your decision.

## Update your books (Goodreads)

Your Goodreads profile is private, so the way in is the CSV export.

1. On Goodreads: **My Books**, then **Import and export**, then **Export Library**. Download the `.csv` file when it is ready.
2. Put it at `~/.agent-fleet/goodreads/goodreads_library_export.csv` (replacing the old one). Keep it out of this folder; `*.csv` is git-ignored as a safety net, but exports hold your private notes.
3. Optional: open `content/books-extra.json` to mark favorites or add a "recommended by" slip.
   - The key is the book's Goodreads Book Id: the number in its Goodreads web address (`goodreads.com/book/show/`**`12345`**`-title`).
   - `"favorite": true` adds the gold star. `"recommendedBy": "Name"` adds the handwritten slip. `"color": "#8c5a78"` picks the spine color yourself (useful when Open Library has no cover or the wrong one). `"showReview": true` publishes that book's review when `reviews` is `"chosen"` (below).
4. Build from your real export: `npm run build` (this is the one command that reads your real books).
5. Look: `npm run serve`, open http://127.0.0.1:8080/books.html. Check the shelf and read the reviews that will show.
6. When you like it, commit the changed `books.html` and `index.html`.

**Which reviews are published** is the `reviews` setting in `site.config.json`:
- `"all"` (the default for now): every review you wrote, except any Goodreads marks as a spoiler.
- `"chosen"`: only books with `"showReview": true` in `content/books-extra.json`.
- `"none"`: no reviews; every book gets the small library card.

A review Goodreads flags as a **spoiler** is never published, whatever this is set to. Your Goodreads private notes are never read. Whatever is on the page is public once the site is hosted.

Notes:
- Only books on your **read** shelf appear. Shelves are grouped by year read; with no read date, the year added is used and the card says "shelved".
- The first build after adding books asks Open Library (once per book) for the cover so the spine can borrow its color. Colors are cached in `~/.agent-fleet/goodreads/spine-colors.json`, **outside this repo** (a list of ISBNs would reveal your reading history, and the pages already carry the colors). The cache is pruned to the books in each build. The sample build keeps its own in `tests/fixtures/`.
- `--offline` skips lookups (new books get a color picked from their title), and so does a Mac without `sips`; `--refresh-colors` retries books that had no cover. Add either after the path, e.g. `node scripts/build.mjs <file.csv> --offline`.
- The bookshelf in the study shows your favorites first, then your most recent reads. That rule is one small function (`selectHomeShelf` in `src/books.mjs`) if you want to change it.
- A rating of 0 on Goodreads means "not rated": no dots are shown.

## Update your links

Edit `site.config.json` (your name, art site, art Instagram, LinkedIn, Substack, résumé path), then run `npm run build:sample`. Pages are rebuilt from it.

Résumé: put your PDF in this folder as `resume.pdf`, and then add the line `!resume.pdf` to `.gitignore` (all PDFs are ignored until you opt in) so it can be committed on purpose.

## Update your writing

Essays are cross-posted to Substack. To add one: copy `docs/essay-template.html` to `writing/my-essay.html`, fill in the `essay-title`, `essay-date` (like 2026-10-30), `essay-summary` and `essay-substack` lines, write the text, then run `npm run build:sample`. The build also rewrites the Substack link at the end of the essay from its `essay-substack` line (keep the two `substack-link` comment markers). The notebook page lists every essay, newest first, grouped by year.

## Update your projects

Edit `content/projects.json` (title, one-line tagline, role, dates, tools, status, links, and three short sections). Each one becomes a tin on the pegboard and its own page. Everything currently in there is a placeholder. The build deletes any `projects/*.html` page that is not in `projects.json`, so do not hand-make pages in that folder.

## Changing how it looks

Ask the designer in `../agent-fleet` first. The styles live in `assets/`, one file per page.
