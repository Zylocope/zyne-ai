# Working on Zyne

Context for anyone (or any session) picking this up cold. Read this before
changing anything — several decisions here look arbitrary but were paid for.

## What it is

A personal reading and focus app. One Tauri codebase, **two platforms doing
deliberately different jobs**:

| | Phone | Laptop |
|---|---|---|
| Purpose | consuming | working |
| Pages | Feed, Journal | Focus, Library, Journal |

The news feed never appears on the laptop, and the focus tools never appear as
a nav item on the phone. This is the core design principle — **don't "unify"
the two platforms.** If a feature seems missing on one, that's usually intent.

No accounts, no server, no telemetry. SQLite for transient state, markdown in
`Documents/ZyneVault/` for anything the user should keep.

## Layout

```
zyne-app/
  index.html              all pages; nav gated by .mobile-only / .desktop-only
  src/js/
    app.js                UI wiring for every page — the big one
    feed.js               source DSL + fetchers (youtube/reddit/hn/github/gnews/rss/books)
    books.js              turns book-summary articles into single-idea cards
    ranker.js             local keyword scoring + optional Claude Haiku pass
    focus.js              Pomodoro state machine, sound roles (pure, tested)
    library.js            reading list + saved ideas as markdown (pure parts tested)
    journal.js            bullet-journal markdown engine
    db.js                 SQLite schema + CRUD, with in-memory fallback for browser dev
    schedule.js           date/recurrence helpers
    focus-library.test.js runnable self-check — `node src/js/focus-library.test.js`
  src/styles/             main.css (theme) · feed.css · focus.css
  src-tauri/              Rust shell; gen/ is generated and git-ignored
```

## Rules that came from the user — don't undo these

- **No data entry.** Books are saved by name from a card, never typed into a
  form. An earlier version asked for author, page count and a "why" paragraph
  and was rejected outright: *"are you making quiz just to read?"*
- **No streaks, due counts, or backlog** anywhere. Reading nudges are
  "you saved this 8 days ago", never "3 overdue". Backlog guilt is what makes
  this class of app get abandoned.
- **Crypto sources are educational only** — how protocols work, never
  buy/sell calls.
- **No X, Instagram or Facebook sources.** Investigated, not viable, dropped.
- **No local LLM.** Ollama was removed on request; don't reintroduce it.
- **The feed must stay off the laptop.**
- Commits carry no `Co-Authored-By` trailer.

## Gotchas that already cost time

**Never commit a PIN hash.** A 6-digit SHA-256 is a 1,000,000-entry search —
recovering one takes ~250ms. The PIN is chosen on first run and stored in
settings (`pin_hash`). Same reasoning for any short secret.

**`src/styles/feed.css` was once found at 0 bytes**, silently removing every
card/PIN/journal style. If the UI looks unstyled, check file sizes before
debugging CSS.

**Book sources must be book-only feeds.** `looksLikeBook()` accepts
`"… Summary"` or `"… by Author"`, which false-positives on titles like
*"How to Decide by Fixing Yourself First"*. Mixed feeds (Farnam Street, Ness
Labs, Sivers) produced podcast episodes posing as books, so only Four Minute
Books and Blas Moros use `books`; the rest are `rss`. Verify before adding.

**Idea extraction is pattern-based, no AI.** `books.js` reads
`content:encoded` and pulls the 1-sentence summary, the author quote and each
`Lesson N:` block. Inline tags (`<a>`, `<em>`) must collapse to *spaces*, not
newlines, or cards start mid-sentence.

**YouTube: the player must stay visible at ≥200×200.** Their API policy
forbids hiding it, overlaying it, or audio-only playback. There is
intentionally no hidden background mode.

**Mobile status bar.** Some Android webviews report `env(safe-area-inset-top)`
as 0, so headers use `max(env(...), 30px)`. Selectors carry `html`/`.is-mobile`
prefixes purely to outrank an id selector — don't "simplify" them away.

**`#focusSlot` moves.** On phones, JS relocates the whole slot (timer, break
panel, night card, sound chips, settings sheet) into the Journal page. Anything
that must work on both platforms belongs *inside* that slot — the Focus page
header is laptop-only.

**Parse once when using `indexOf`.** Calling `parseSounds()` twice and doing
`all.indexOf(x)` compares different object instances, returns -1, and the
click silently does nothing.

**`git filter-branch` mangles merge history** — it dropped 6 commits including
two PR merges. Use `git filter-repo` for any history rewrite, and always
compare commit counts, merge counts and tree SHAs before pushing.

**Network reality:** `openlibrary.org` resolves but its TCP connections are
blocked in at least one development environment, and Google Books returns 429
without a key. Book metadata lookup is therefore not relied on anywhere.

## Sound roles

```
loop  <link> | Label            background; auto-resumes on "+", repeats
break <link> | Label | minutes  guided; offered only if the break is long enough
night <link> | Label | minutes  once-a-night ritual; own card, done-for-today mark
```

## Commands

```bash
pnpm install
pnpm tauri dev                                     # desktop
pnpm tauri build                                   # Windows installer
pnpm tauri android build --apk --target aarch64    # signed APK
node zyne-app/src/js/focus-library.test.js         # self-check
```

Browser-only dev (`pnpm dev`) works for UI work: feed fetches route through a
`/zx` vite proxy, and DB/vault fall back to memory and localStorage. **File
writes only happen in the real Tauri app** — the browser can't touch
`Documents/ZyneVault`.

Verify UI changes in the browser preview before building; the builds are slow.

## Known gaps

- **No sync.** Each device has its own vault and settings, so the phone's
  clips and the laptop's reading list never meet. Most likely next feature.
- Book ideas come from two feeds, so volume is thin (~8 books per refresh).
- AI ranking is optional; local keyword scoring is the default and the
  fallback whenever the API call fails for any reason.
- Idea cards are the summariser's words about a book, not the book's own prose
  (except quote cards). Cards always name their source and link out.
