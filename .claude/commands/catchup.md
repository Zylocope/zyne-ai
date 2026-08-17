---
description: Orient a fresh chat on this project — read the docs, inspect real state, then wait for direction
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git status:*), Bash(git diff:*), Bash(node:*), Bash(ls:*), Bash(wc:*)
---

You are starting cold on this project. Get oriented from the repo itself
before doing anything, and do not start changing code.

## 1. Read

- `CLAUDE.md` — architecture, the rules that came from the user, and the traps
  already hit. Treat its "Rules that came from the user" section as binding.
- `STATUS.md` — where the work actually stopped and what was being considered
  next.
- `README.md` — only if you need the user-facing framing.

## 2. Verify rather than trust

Docs drift; the repo does not. Check:

```
git log --oneline -12
git status --short
node zyne-app/src/js/focus-library.test.js
```

Then confirm the codebase matches what STATUS.md claims — if it says a feature
shipped, find it in the source. **Say so plainly if the docs and the code
disagree**; a stale handoff is worse than none.

Also sanity-check that no stylesheet is empty (this has happened before and
silently removes every style):

```
wc -c zyne-app/src/styles/*.css
```

## 3. Report back, briefly

Give the user:

- One short paragraph on what this project is and the phone/laptop split.
- Where the last session stopped, and anything left unfinished or unverified.
- Any drift you found between the docs and the code.
- The two or three most sensible next moves, with a recommendation.

Keep it under roughly 200 words. The user knows this project — you are the one
catching up, so do not explain their own app back to them at length.

## 4. Stop

Ask what they want to work on, and wait. Do not begin implementing, refactoring
or "improving" anything on your own initiative.

$ARGUMENTS
