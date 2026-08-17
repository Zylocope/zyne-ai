# Status — 2026-08-17

A snapshot of where the work stopped. Rewritten by `/handoff`, read by
`/catchup`. For durable project knowledge see [CLAUDE.md](CLAUDE.md).

## Where things stand

Everything committed and pushed; working tree clean. Both self-check suites
pass. Windows installer and signed arm64 APK were built from this commit and
delivered — but **neither has been confirmed running on real hardware yet.**

Shipped and verified in the browser preview:

- `+` timer merged with the old Activity Tap. Four rhythms (Pomodoro 25/5,
  52/17, 90/20 deep block, Flowtime count-up), each showing what it suits.
  Stopping writes `Focused Nm on X` into the day's journal.
- Sound roles: `loop` background auto-resumes on `+`; `break` guided sessions
  offered only when the break is long enough; `night` once-a-night ritual on
  its own card with a done-for-today mark.
- Library as a book-idea feed — one idea per card, pattern-extracted from Four
  Minute Books and Blas Moros, no AI and no typing. Save an idea to the vault,
  save a book to the reading list, which then nudges during breaks.
- PIN moved out of source: chosen on first run, hashed into local settings.
- Sound settings reachable on phones (whole `#focusSlot` relocates to Journal).

## Waiting on the user

- **First launch of both apps will ask for a new PIN.** Expected, not a bug —
  the old hardcoded hash was removed before the repo went public.
- The Wim Hof link has not been added yet; needs a `night` line in sound
  settings.
- The night card has no time gate by explicit choice, so it sits on the
  Journal all day. Revisit only if it turns out to nag.

## Next candidates

1. **Sync between devices** — the clearest gap. Each device has its own vault
   and settings, so phone clips never reach the laptop Library and the sound
   list must be entered twice. Most likely to be felt daily.
2. **More book sources** — only two feeds qualify, so ~8 books per refresh
   gets repetitive. Needs feeds that are book-only; see the `looksLikeBook`
   trap in CLAUDE.md before adding any.
3. **A memory MCP** (e.g. basic-memory, markdown-backed) if `/catchup` and
   `/handoff` prove too manual.

## Loose ends

- `babyland_admin_dashboard` still shows a `Co-Authored-By: Claude` trailer on
  one commit. A verified rewrite was prepared but the force-push was declined
  by a permission gate, and the user chose to leave it. Rewriting would break
  a second contributor's clone.
- AI feed ranking is untested end to end against a live API key; local keyword
  scoring is the default and the fallback on any failure.
