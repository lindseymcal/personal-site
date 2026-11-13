# Personal site

A lamplit study. Each object in the room is the way into one part of the site. Plain HTML and CSS, no framework, nothing to install.

- **Your real site:** `npm run build` reads your Goodreads export and writes the complete site (pages, styles, fonts, pictures, résumé) into the git-ignored `site/` folder. Look at it with `npm run serve:site`, then open http://127.0.0.1:8080 (or open `site/index.html` directly). Run `npm run build` after ANY change you want on the site (books, links, essays, projects).
- **The repo root** (`index.html`, `books.html`, ...) holds only the committed *sample* pages, built from fake books. Real builds never write there, and `npm run refresh:sample` (the sample refresh, for developers and agents) is the only thing that does.
- `npm run build:sample` builds a preview of the sample site into the git-ignored `preview/` folder.
- **Tests:** `npm test`
- The build always needs a CSV path and refuses to run without one. It also stops, changing nothing, if the CSV doesn't look like a Goodreads export or has no read books (`npm run build -- --allow-empty` to override), or if it would forget more than half of the saved cover colors (`npm run build -- --prune` to override).
- **Export from Goodreads once before your first `npm run build`; until then the build stops** (it can't find your CSV).
- **Design reference:** `docs/design/index.html` (the designer's mockups and the decisions behind them)

**Publishing** is your decision and nothing is set up. When you decide: `site/` is the complete, ready-to-serve folder (no build needed to serve it), so hosting means deploying that folder (for example to a `gh-pages` branch for GitHub Pages). Everything on the page is public once hosted.

There is no remote. Nothing here is published.

## Update your books (Goodreads)

Your Goodreads profile is private, so the way in is the CSV export.

1. On Goodreads: **My Books**, then **Import and export**, then **Export Library**. Download the `.csv` file when it is ready.
2. Put it at `~/.agent-fleet/goodreads/goodreads_library_export.csv` (replacing the old one). Keep it out of this folder: the build refuses a CSV inside the repo, and `*.csv`, `*.numbers`, `*.xlsx`, `*.xls`, `*.ods`, `*.tsv` and files named `goodreads*` in the repo root or `goodreads_library_export*` anywhere are git-ignored as a safety net, but exports hold your private notes.
3. Optional: open `content/books-extra.json` to mark favorites or add a "recommended by" slip.
   - The key is the book's Goodreads Book Id: the number in its Goodreads web address (`goodreads.com/book/show/`**`12345`**`-title`).
   - `"favorite": true` adds the gold star. `"recommendedBy": "Name"` adds the handwritten slip. `"color": "#8c5a78"` picks the spine color yourself (useful when Open Library has no cover or the wrong one). `"showReview": true` publishes that book's review when `reviews` is `"chosen"` (below).
4. Build from your real export: `npm run build` (this is the one command that reads your real books).
5. Look: `npm run serve:site`, open http://127.0.0.1:8080/books.html. Check the shelf and read the reviews that will show. (`site/` is never committed.)

**Which reviews are published** is the `reviews` setting in `site.config.json`. It is `"chosen"` (and also what you get if the setting is missing): **a review is published only if you mark that book.** To publish a review, add `"showReview": true` for that book in `content/books-extra.json`:

```json
"12345": { "favorite": true, "showReview": true }
```

Unmarked books show the small library card (rating and date) and their review stays private. The other values:
- `"all"`: every review you wrote, except any Goodreads marks as a spoiler.
- `"none"`: no reviews; every book gets the small library card.
- Anything else (a typo, capital letters, a stray space) is treated as `"none"`, with a warning, so a mistake never publishes more than you meant.

A review Goodreads flags as a **spoiler** is never published, whatever this is set to. Your Goodreads private notes are never read. Whatever is on the page is public once the site is hosted.

Notes:
- Only books on your **read** shelf appear. Shelves are grouped by year read; with no read date, the year added is used and the card says "shelved".
- The first build after adding books asks Open Library (once per book) for the cover so the spine can borrow its color. Colors are cached in `~/.agent-fleet/goodreads/spine-colors.json` (used only for your real export), **outside this repo** (a list of ISBNs would reveal your reading history, and the pages already carry the colors). The cache is pruned to the books in each build. The sample build keeps its own in `tests/fixtures/`.
- `--offline` skips lookups (new books get a color picked from their title), and so does a Mac without `sips`; `--refresh-colors` retries books that had no cover. Add either after the path, e.g. `node scripts/build.mjs <file.csv> --offline`.
- On the books page, each year's shelf reads left to right in the order you read them (oldest on the left, newest on the right); years run newest first from the top. The bookshelf in the study shows your most recent reads (date read, or date added when there is no read date), laid out the same way: oldest of those on the top left, newest on the bottom right.
- Spine lettering is fitted automatically: long titles wrap into columns and shrink as far as needed (down to 5px) so the whole title shows; only a title that cannot fit even then ends in an ellipsis. A subtitle after a colon is left off the spine (the full title is in the book's label and tooltip). A long author name runs up the spine instead of across it.
- Favorites get their gold star but no special place on the study's shelf; which books it shows is one small function (`selectHomeShelf` in `src/books.mjs`) if you want to change it.
- A rating of 0 on Goodreads means "not rated": no dots are shown.

## Update your links

Edit `site.config.json` (your name, art site, art Instagram, LinkedIn, Substack, résumé path), then run `npm run build`. Pages are rebuilt from it.

Résumé: the published copy lives at `assets/resume.pdf` (set as `resumePath`). It has had the phone number removed. All PDFs are git-ignored except exactly that file (see `.gitignore`).

## Update your writing

Your essays come from your Substack (https://substack.com/@lindseymcal, publication feed `https://lindseymcal.substack.com/feed`, set as `substackFeedUrl` in `site.config.json`). Publish on Substack, then run `npm run build`: the build makes one request to the feed and lists each post (title, date, a short summary) in the notebook, newest first, grouped by year. Each entry links to the post on Substack, in the same tab. Only plain text is taken; post bodies are not imported.

The last good copy of the list is kept in `content/substack-feed.json` (it is your public writing, so it is committed). If you are offline, or Substack is down, the build uses that copy and says so. There are no local essay pages.

## Update your projects

Edit `content/projects.json` (title, one-line tagline, role, dates, tools, status, links, and three short sections). Each one becomes a tin on the pegboard and its own page. Everything currently in there is a placeholder. The build deletes any `projects/*.html` page that is not in `projects.json`, so do not hand-make pages in that folder.

## Changing how it looks

Ask the designer in `../agent-fleet` first. The styles live in `assets/`, one file per page.
