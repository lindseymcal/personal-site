# Personal Site: rules for every agent

Zee's personal website (Zee uses she/her): a lamplit study where every object is a doorway (bookshelf to Books, notebook to Writing, pegboard to Projects, painting to her art site, taped photo to Instagram, bag to résumé and LinkedIn). Built by Zee's agent fleet (`../agent-fleet`), whose guardrails also apply here.

It's also a learning project: explain what you're doing and why, and prefer code Zee can read and change.

## Rules
- **Merging and pushing are Zee's call.** Never merge, push, publish, or delete branches without Zee's explicit approval in chat. Never commit directly to `main`. There is no remote on purpose; hosting is Zee's decision.
- No secrets or personal data in code, logs, or commits. **Never commit a Goodreads export** (`*.csv` is git-ignored; the one fake sample in `tests/fixtures/` is the exception). Don't run the build on Zee's real CSV unless Zee asks. Its output goes to the git-ignored `site/` folder and is never committed (her reviews would become public).
- **No npm dependencies** and no framework: plain HTML, CSS and ES-module JavaScript. Ask Zee before adding any.
- Pure logic (CSV parsing, ISBN cleanup, row to book, dates, ratings, escaping, home-shelf choice, spine sizes and colors, contrast, BMP color) lives in exported functions under `src/` and is tested with `node:test` (`npm test`) without a browser or the network.
- Everything that came from a CSV, a JSON file or the Substack feed is escaped (`escapeHtml`) before it goes into a page. Never write raw CSV text into HTML.
- Small, reviewable changes; one concern per change.

## How it works
- **The build needs an explicit CSV path, and where it writes is fixed.** `npm run build` (Zee's real export) writes the complete deployable site into the git-ignored `site/`, never the repo root; agents do not run it. `npm run build:sample` previews the fake sample into the git-ignored `preview/`. The repo root holds only the committed SAMPLE pages, refreshed by `npm run refresh:sample` (the only path that writes the root; it is refused for any CSV outside `tests/fixtures/`). `--out` may only be `site/` or `preview/`. Reviews are published only for books marked `showReview` (`reviews: "chosen"`, also the default); unknown `reviews` values fail closed to "none".
- `scripts/build.mjs` reads the Goodreads CSV plus `site.config.json`, `content/*.json` and the Substack feed, and writes `index.html`, `books.html`, `writing.html`, `projects.html` and `projects/*.html` (plus a copy of `assets/`) into the output folder. The root pages are the committed sample; the real site is `site/`, which can be served as-is (no build needed to serve).
- `src/render.mjs` holds the page templates, `src/build-site.mjs` ties the pure pieces together, and `assets/*.css` holds the styles (one file per page, plus `site.css`).
- Open Library cover colors are looked up at build time only (`src/cover.mjs`) and cached outside the repo in `~/.agent-fleet/goodreads/spine-colors.json` (the sample build uses `tests/fixtures/sample-spine-colors.json`).
- Essays come from Zee's Substack RSS feed (`src/feed.mjs`): one request at build time (https, substack.com hosts or an explicitly named custom domain, 1 MB cap, 15 s timeout), plain text only, cached in `content/substack-feed.json`. Post bodies are never imported (that would need an HTML sanitizer).

## Design
The source of truth is `docs/design/` (copies of the designer's mockups; start at `index.html`). Decisions that must hold:
- One route into each section: no top nav, no bottom banner. Way home is the round brass window, top-left on every inner page, `aria-label="Back to the study"`, first in tab order. Deeper pages add a second small object (notebook to Writing, tin to Projects). Project pages have no extra résumé link.
- The only always-visible text on the desktop study is the name; labels show on hover/focus, and every object has an aria-label. On phone, labels stay visible.
- Every object has its own small hover/focus motion inside `@media (prefers-reduced-motion: no-preference)`.
- Scene pages are drawn at 1280x800 and scale to fit the window (a tiny inline script sets `--s`); below 700px the phone layout takes over.
- Changes to how it looks go through the designer in `../agent-fleet` first (mockups, Zee picks, then the coder builds).
