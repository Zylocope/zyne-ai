# ZYNE.AI

Personal feed reader + bullet journal. Tauri 2 + Vanilla JS + SQLite. No accounts — a 6-digit PIN lock on open. No Ollama, no local AI dependencies.

The two platforms deliberately do different jobs. **Phone = consuming** (Feed, Journal). **Laptop = working** (Focus, Library, Journal). The feed never appears on the machine you work on, and the focus tools never appear on the machine you browse from.

## Pages

- **Feed** (main) — Pinterest-style 2-column card grid from ~60 curated sources (YouTube channels, subreddits, Hacker News, GitHub repos, Google News topics, RSS). Video cards span full width with big thumbnails; articles/posts are tiles with source favicons. Filter chips: All / Videos / Articles / Community. Batch capped at 60, round-robined across sources so no single feed dominates, ending with "You're caught up" + mark-all-read. Tap to open, bookmark icon clips to your vault as markdown.
- **Focus** *(laptop; the timer itself is on both)* — one `+` button. Type what you're doing, press Enter, it runs; stop it and the session writes itself into today's journal as `Focused 52m on X`. Four rhythms to pick from — Pomodoro 25/5, 52/17, a 90/20 deep block, and Flowtime which just counts up — each with a line saying what it suits. Plus a sound dock you fill with your own YouTube links — see below.

### Focus sounds

Sounds carry a role, because background music and a guided breathing session want opposite handling:

```
loop  <youtube link> | Lofi radio
loop  <youtube link> | Justin Sung focus music
night <youtube link> | Wim Hof breathing | 10
break <youtube link> | Box breathing     | 5
```

`loop` is background — it resumes automatically when you press `+` and repeats until you stop.

`break` is a guided session: offered during breaks, played once, never looped. The trailing number is its length in minutes, and it's only offered when the break is long enough to hold it, so a 10-minute session never appears in Pomodoro's 5-minute break.

`night` is a once-a-night ritual that ignores the timer entirely. It sits as a card on the Journal until you play it, then marks itself done and rests until tomorrow. Tick it manually if you did it away from the app.

Untagged lines are treated as background. Break sessions are offered as a chip, never auto-played, so a break can still just be a break — and every sound stays tappable manually.

The player is a visible 280×200 dock in the corner: [YouTube's policy](https://developers.google.com/youtube/terms/required-minimum-functionality) forbids hiding or overlaying it, or playing audio-only. That applies to breathing videos as much as to music.
- **Library** *(laptop; a Books chip on the phone)* — a discovery feed of **one idea per card**, lifted from book-summary feeds and ranked by the same interest profile as your news. You never type book data. Save an idea and it becomes markdown in the vault; save the book and it joins your reading list, which then turns up during your timer breaks.
- **Journal** — bullet journal per day: **timed events** (SQLite: recurrence + reminders), **tasks** and **notes** (markdown daily files). Tasks can be completed, **migrated to tomorrow** (`- [>]`), or **skipped** (`- [-]`) — Obsidian Tasks-compatible markers. Mini-month calendar picks the day; Activity Tap timers live here collapsed.

## Obsidian vault

Everything markdown lands in `Documents/ZyneVault/`:

```
ZyneVault/
  journal/2026-07-27.md   daily logs (tasks + notes, bullet-journal states)
  clips/2026-07-27-*.md   clipped feed articles
  reading-list.md         books you saved, one line each
  ideas/2026-08-17-*.md   idea cards you kept
```

### Where book ideas come from

`books <feed-url>` sources publish their full article in RSS with a consistent shape, so a single idea can be lifted out by pattern alone — no AI, no API key, nothing to type. Four Minute Books yields the one-sentence pitch, the author quote, and each numbered lesson; Blas Moros yields his per-book notes.

Only entries that actually name a book (`… Summary` or `… by Author`) become cards, so a feed that also carries podcasts and essays contributes just its book posts. Add more with a `books` line in settings — but check the feed is book-only first, since titles like *"How to Decide by Fixing Yourself First"* will otherwise slip through the name check.

Except for quote cards, these are the summariser's words about a book, not the book's own prose. Every card names its book and links to the full summary.

**Known gap:** the vault is per-device. On Android it lives in app storage, so clips saved on the phone don't reach the laptop's Library yet. Books and journal entries written on the laptop are the ones Obsidian sees.

Point Obsidian at `ZyneVault` and it all shows up. Daily files use the standard `YYYY-MM-DD.md` daily-note naming.

## Sources

Tap the sliders icon on the Feed page. One source per line, `#` for comments:

```
youtube <channelId> | Display Name
reddit <subreddit>
hn front
github <owner/repo>
gnews <world|business|technology|science|nation>
rss <url> | Display Name
```

Defaults ship ~60 verified sources across AI/LLM, business & strategy, product, code, design, crypto education, China tech, world news, creators, and books.

## Ranking

Both modes score against the **interest profile** in the gear sheet — edit that text whenever the feed drifts, and keep its `SCORE 0-2` line (everything above counts as signal, below as noise).

- **Local (default, free, offline).** Keyword scoring derived from the profile. No key, no cost, no network. Good enough to bury crime, sports, celebrity, and coin-shilling.
- **Haiku (optional).** Paste an Anthropic API key and each refresh sends one batched `claude-haiku-4-5` call (~1-3¢). Better judgement, plus a one-line hook on cards scoring ≥6.

If the key is missing, invalid, or out of credits, the app falls back to local scoring automatically — it never leaves you with an unranked feed. Locally-scored items keep `hook = NULL`, so a later Haiku pass upgrades them. Either way the feed orders by score, capped at 4 cards per source.

## Run

```
pnpm install
pnpm tauri dev
```

Browser-only dev (`pnpm dev`) works too: feed fetches route through a generic `/zx` vite proxy, DB/journal fall back to memory/localStorage.

## PIN

Checked against the SHA-256 constant `PIN_HASH` in `src/js/app.js`. To change it, hash the new digits and replace the constant. Convenience lock, not encryption.

## Build

```
pnpm tauri build                            # desktop
pnpm tauri android build --apk --target aarch64   # phone (signed APK)
```

APK output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/`.

### Android signing (after a fresh clone)

`src-tauri/gen/` is generated and git-ignored — it also holds the signing key, which must never be committed. To rebuild the Android project on a new machine:

```
pnpm tauri android init
```

Then restore signing. Generate a keystore (or copy your existing one — back it up somewhere private; losing it means Android will refuse to install an update over the old app):

```
keytool -genkeypair -v -keystore src-tauri/gen/android/zyne-release.keystore -alias zyne -keyalg RSA -keysize 2048 -validity 10000
```

Create `src-tauri/gen/android/keystore.properties`:

```
password=<your keystore password>
keyAlias=zyne
storeFile=zyne-release.keystore
```

Finally add the signing config to `src-tauri/gen/android/app/build.gradle.kts` — load the properties near the top:

```kotlin
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) { propFile.inputStream().use { load(it) } }
}
```

then inside `android { }`, before `buildTypes`:

```kotlin
signingConfigs {
    create("release") {
        keyAlias = keystoreProperties.getProperty("keyAlias")
        keyPassword = keystoreProperties.getProperty("password")
        storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
        storePassword = keystoreProperties.getProperty("password")
    }
}
```

and add `signingConfig = signingConfigs.getByName("release")` as the first line of `getByName("release") { … }`.

## File layout

```
index.html            UI shell: PIN lock + Feed + Journal + bottom nav
src/
  js/
    app.js            app logic: PIN, nav, feed UI, journal UI, reminders
    feed.js           source DSL + fetchers + cross-source interleaving
    journal.js        bullet-journal markdown engine + article clips
    db.js             SQLite schema + CRUD (+ in-memory fallback for browser dev)
    schedule.js       calendar/date helpers
  styles/main.css     theme + layout (skeuo dark)
  styles/feed.css     feed grid, cards, chips, PIN pad, journal rows
src-tauri/            Rust shell + plugins: sql, http, fs, opener, notification
```

## Roadmap ideas

- Feed-back loop: taps and clips automatically refine the interest profile.
- Weekly digest note written into the vault.
