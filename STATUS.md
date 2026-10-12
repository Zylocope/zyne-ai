# Status — 2026-08-17

Snapshot of where work stopped. Rewritten by `/handoff`, read by `/catchup`.
Durable project knowledge lives in [CLAUDE.md](CLAUDE.md) — this file is only
the present moment.

## Where things stand

Working tree clean, everything pushed, both self-check suites pass
(`node zyne-app/src/js/focus-library.test.js`). Three commits on `main`.

The repo is **public** at https://github.com/Zylocope/zyne-ai.

Verified in the browser preview, including under an emulated Android UA:

- `+` timer (merged with the old Activity Tap). Four rhythms, each showing what
  it suits. Stopping writes `Focused Nm on X` into the day's journal.
- Sound roles `loop` / `break` / `night`. Break sessions only appear when the
  break is long enough; `night` is a once-a-night card with a done-for-today
  mark that survives reload and can be un-ticked.
- Library as a book-idea feed — one idea per card, pattern-extracted, no AI and
  no typing. 8 cards from 2 sources, all genuine books.
- PIN chosen on first run, hashed into local settings, absent from source.
- The whole `#focusSlot` relocates to the Journal page on phones, so the timer,
  night card, sound chips and settings sheet are all reachable there.

**Not verified:** neither build has been confirmed running on real hardware.
`~/Desktop/zyne-setup.exe` (4.9 MB) and `~/Desktop/zyne.apk` (22 MB) were built
from the current commit and delivered, but no install has been reported back.

## In flight

Nothing uncommitted. Two things are waiting on the user, not on code:

- **First launch of either app will ask for a new PIN.** Expected — the old
  hardcoded hash was removed before publishing. Not a bug; don't "fix" it.
- **The Wim Hof link still hasn't been added.** It needs a `night` line in the
  sound settings. Until then the night card is invisible, which is correct
  behaviour, not a failure.

Also parked: a prepared history rewrite for a *different* repo,
`babyland_admin_dashboard`, which strips a `Co-Authored-By: Claude` trailer.
Verified clean (41 commits, 11 merges, identical tree, all three authors
preserved) in a scratch clone, but **the force-push was blocked by a permission
gate and never ran** — the trailer is still on that remote. The user said "it is
okay if you can't", so treat this as closed unless they reopen it.

## Decided this session

- **The repo went public, so the PIN had to leave the source.** A 6-digit
  SHA-256 was recovered from the committed hash in 265 ms; publishing it would
  have published the PIN. History was rewritten to purge it rather than just
  deleting it forward.
- **A nightly ritual is not a break session.** Wim Hof breathing is done once a
  night, so it ignores the timer entirely. The user chose **no time gate and no
  notification** — the card sits there all day until played.
- **Sound UI had to move.** It lived in the Focus page header, which is
  laptop-only, so phones could not reach sound settings at all — fatal for a
  bedtime ritual.
- **Third-party context-handoff skills were evaluated and rejected.** They
  preserve raw transcript slices rather than curated intent, and the best of
  them needs a supervisor process that rewrites `/compact` into `/clear`.
  `/catchup` and `/handoff` were written instead — project-level here, generic
  copies in `~/.claude/commands/` for the user's other repos.
- **Books remain typing-free.** The earlier form asking for author and page
  count was rejected outright: *"are you making quiz just to read? … NO NO
  NOOOOO adding info no more than the book name."* Do not reintroduce a form.

## Next candidates

1. **Sync between devices** — recommended. The phone and laptop keep separate
   vaults *and* separate settings, so the sound list typed on one doesn't reach
   the other, and phone clips never reach the laptop's Library. This is the
   gap the user is most likely to hit next, and it was flagged to them twice.
2. **More book sources** — ~8 books per refresh is thin. Needs feeds that are
   book-only; see the `looksLikeBook` trap in CLAUDE.md before adding any.
3. **Time-gate the night card** — only if the user reports it nagging during
   work hours. They explicitly chose the always-visible version, so don't do
   this pre-emptively.

## What bit us

The durable traps from this session were moved into **CLAUDE.md** — committed
PIN hashes, `git filter-branch` silently dropping 6 commits (use
`git filter-repo`), the double-`parseSounds` identity bug, and
`env(safe-area-inset-top)` reporting zero on Android.

Session-specific only: the force-push permission gate above, and a reminder
that **the browser preview cannot write to `Documents/ZyneVault`** — vault
behaviour is only real in the Tauri app, so "it worked in the preview" does not
prove file writing works.
