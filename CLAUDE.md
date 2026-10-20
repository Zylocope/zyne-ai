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

No accounts, no telemetry. SQLite for transient state, markdown in
`Documents/ZyneVault/` for anything the user should keep.

Two deliberate exceptions to "no server", both added with the companion work
and both **off unless you turn them on**:

- **LAN pairing** (`companion.rs`) runs a `tiny_http` listener on `0.0.0.0:0`
  so a phone can reach the laptop directly. Every request needs
  `Authorization: Bearer <64-hex>`, compared in constant time before routing;
  the client side refuses any address that is not private, loopback or
  link-local; the listener stops itself after 30 minutes. Nothing leaves the
  local network.
- **Gemini** (`ai_chat`, `ai_suggest`) is opt-in and needs a key you import
  yourself. The key lives in `gemini-private.json` in app data — `0o600` on
  unix, never in the JS bundle and never in a sync payload. Model is the one
  `AI_MODEL` constant in `companion.rs` (gemini-2.5-flash). When enabled,
  chat text and the "What next?" day summary (today's tasks/events, last 7
  journal days, reading list, optional "what matters lately" line) go to
  Google — the one place Zyne talks to a third party. The suggest prompt lives
  in Rust so the page can't repurpose the key. Nudges are a second switch
  (`ai_nudges` setting): max 4 a day, never during focus, only while open.

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
    coach.js              "What next?" day summary, reply parsing, nudge slots (pure, tested)
    card3d.js             full-screen 3D daily card stage (phone)
    tools.js              the small self-care screens: grounding, calm, jar,
                          reflection, looking back, borrowed goals (pure parts tested)
    tarot.js              78-card deck + lines to sit with (pure, tested)
    library.js            reading list + saved ideas as markdown (pure parts tested)
    journal.js            bullet-journal markdown engine
    db.js                 SQLite schema + CRUD, with in-memory fallback for browser dev
    schedule.js           date/recurrence helpers
    focus-library.test.js runnable self-check — `node src/js/focus-library.test.js`
  src/styles/             main.css (theme) · feed.css · focus.css · daylight.css
                          (daylight.css is load-bearing, not optional — it defines
                           the focus welcome block and timer idle copy)
                          glass.css: phone-only floating Liquid-Glass nav + gradient
                          background; backdrop blur only, no SVG displacement (Android lag)
                          settings.css: the Settings panel (slide-in page; grouped list,
                          one section at a time). Replaced the old floating sheets.
  src-tauri/              Rust shell; gen/ is generated and git-ignored
```

## Rules that came from the user — don't undo these

### UI ownership contract

Claude owns implementation and makes the functions reliable. Codex owns the
product UI/UX and adapts the interface after functions change. When adding a
feature, preserve stable ids and callable functions, but do not assume its
first HTML placement or developer-facing copy is the final user experience.

- Design from the user's next decision, not from the storage or API structure.
- Every visible control needs a plain-language label or an immediately clear
  context. Tooltips and undocumented icons are not the primary explanation.
- Group related capabilities under a human goal such as “Connect devices” or
  “Save a backup”; avoid presenting several internal systems at equal weight.
- The first screen state must explain what can be done without setup knowledge.
- Keep advanced settings and file/API details available, but one level below
  the primary action.
- Preserve the warm daylight visual language, comfortable touch targets, and
  responsive behavior on both phone and laptop.
- After UI changes, run the self-check and production web build. Do not change
  working feature behavior just to achieve a visual layout.

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

**Never commit a short secret's hash.** The app-wide PIN was removed in
v0.1.1 — the app now opens directly and device lock is the access control —
but the lesson stands: a 6-digit SHA-256 is a 1,000,000-entry search,
recovered in ~250ms, so committing such a hash publishes the secret.

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
panel, night card, sound chips) into the Journal page. Anything
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

**The tarot deck is ours, not a published one.** The 78-card structure and
the traditional names are public domain, and Daughter/Son/Mother/Father is a
four-word naming convention — but every image line and keyword set in
`tarot.js` was written for this app. Don't paste in text or art from a
published deck or its guidebook. One draw a day, stored as
`tarot_drawn = <iso>|<index>`; it writes the card into that day's journal and
goes face-down again at midnight (hooked to the existing clock tick).
**Phone only** (user asked to remove it from the laptop): a compact row in
Journal opens `card3d.js`, a full-screen CSS-3D stage — pick one of three,
flip, drag/gyro tilt, swipe to turn over. CSS 3D, not WebGL, on purpose:
crisp text and cheap on Android WebView.
Under the card sits **Today's lens** (`ai_lens`, coach.js): Mind (thinking),
Heart (feelings), People (social) and one if–then plan the user can add to
the journal. The card is a theme, never a prediction. Without AI it uses
`LOCAL_LENS` per suit; AI results are cached per day as `tarot_lens`.

**`j-` class names belong to the journal.** `j-row`, `j-note`, `j-text`,
`j-title`, `j-meta`, `j-check`, `j-act` and friends style the day log. The
jar first shipped with `j-note` and silently restyled every note in the
journal. New screens prefix their own classes (`jar-`, `g-`, `t-`, `goal-`).

**Self-care screens keep no score.** Mood is words, not 1-to-5, because a
number invites you to chase a higher one. Looking back counts days per mood
and never a run of them. The same rule as the reading nudges: no streaks.

**Feed requests have deadlines.** `httpGet` aborts after 10 s and each source
is capped at 20 s (`withTimeout` in feed.js); ranking is capped at 30 s and
the refresh spinner stops as soon as items render. Without this, one site
that never answers kept the spinner going forever.

**Showcase = a source group.** Lines under a `# ── Showcase` header in the
sources text feed the Showcase chip (matched by source display name, so no DB
change). Seed v4 appends `SHOWCASE_SOURCES` to an existing list instead of
resetting it. Show HN (hnrss, 50+ points) was verified live; reddit couldn't be
fetched from the dev environment but uses the same fetcher as the other subs.

**QR pairing.** The laptop renders the pairing code as an SVG QR (`qrcode`,
local). The phone scans with `tauri-plugin-barcode-scanner` (mobile-only
dependency, `capabilities/mobile.json`); paste stays as a fallback.

## Sound roles

```
loop  <link> | Label            background; auto-resumes on "+", repeats
break <link> | Label | minutes  guided; offered only if the break is long enough
night <link> | Label | minutes  once-a-night ritual; own card, done-for-today mark
```

## Commands

**Releasing:** `UPDATE.bat` at the repo root (runs `update.ps1`) bumps the patch
version in package.json / tauri.conf.json / Cargo.toml, runs the self-check,
builds both apps and copies them to `releases/` (git-ignored; older builds go to
`releases/old/`). User-facing guide: `HOW-TO-UPDATE.md`. Keep that flow working.

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
