---
description: Write the current session state into STATUS.md before context runs out
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git log:*), Bash(git status:*), Bash(git diff:*)
---

Context is filling up. Capture the state of this session into `STATUS.md` so
the next chat can resume without the user re-explaining anything.

First look at what actually happened — do not write from memory alone:

```
git log --oneline -15
git status --short
git diff --stat
```

Then rewrite `STATUS.md` so it holds, in this order:

1. **Where things stand** — the last thing finished, and whether it was
   verified or merely written. Be honest about the difference.
2. **In flight** — anything half-done, plus uncommitted or unbuilt changes.
3. **Decided this session** — choices the user made and the reason, especially
   ones that would look arbitrary later or that you were told to stop doing.
4. **Next candidates** — two or three, with your recommendation and why.
5. **Anything that bit us** — new traps worth knowing. If a trap is permanent
   rather than session-specific, move it into `CLAUDE.md` instead; `STATUS.md`
   is for the present moment, `CLAUDE.md` is for what stays true.

Rules for the file:

- Keep it under roughly 60 lines. A long handoff is one nobody reads.
- Replace the old contents; this is a snapshot, not a changelog. Git already
  keeps the history.
- Date it.
- No secrets, no PINs, no personal paths — this repo is public.
- Plain statements over optimism: "built, not yet tested on the phone" beats
  "phone support complete".

When you are done, show the user the file and say in one line what you would
pick up first next time.

$ARGUMENTS
