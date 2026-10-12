# Zyne: folders and updates

## What is where

```
Desktop\Zyne_ai\                 ← everything for Zyne lives here
  zyne-app\                      the source code (one codebase → both apps)
    src\                         the screens: JS, CSS (what you see)
    src-tauri\                   the Rust shell: AI calls, files, notifications
  releases\                      ← the apps you install
    Zyne-0.1.2-setup.exe         laptop installer (newest)
    Zyne-0.1.2.apk               phone app (newest)
    old\                         earlier versions, just in case
  UPDATE.bat                     ← double-click to build new installers
  update.ps1                     what UPDATE.bat runs
  HOW-TO-UPDATE.md               this file
  CLAUDE.md                      notes for Claude: rules and gotchas
  STATUS.md                      what was built last and what's open
```

- **zyne-app** = the code. Change it, then build.
- **zyne-setup / Zyne-x.y.z-setup.exe** = the *installer* made from the code. It is a snapshot,
  so it does not change by itself when the code changes. That's why it felt "not updated".
- **Desktop\zyne-app shortcut** opens the app that's already installed (in AppData). Keep it.
- `C:\Users\Zyne\zyne-ai` is an old, empty Next.js starter from April. It is **not** this app.

## The update loop (every time)

1. **Change the code**: ask Claude, or edit yourself.
2. **Double-click `UPDATE.bat`.** It:
   - raises the version by one (0.1.2 → 0.1.3)
   - runs the self-check (stops early if something is broken)
   - builds the laptop installer and the phone APK (10-25 min total)
   - puts both in `releases\` and moves the previous ones to `releases\old\`
3. **Install:**
   - Laptop: run `releases\Zyne-x.y.z-setup.exe`. It updates in place and your data stays.
   - Phone: send `releases\Zyne-x.y.z.apk` to the phone (USB, Telegram Saved Messages,
     or Drive), tap it, then **Update**. Journal and settings stay.
4. **Save the code to GitHub** (in this folder):
   ```
   git add -A
   git commit -m "Zyne x.y.z"
   git push
   ```

Only one side changed? `UPDATE.bat -Only desktop` or `UPDATE.bat -Only phone`.
Rebuild without a new version: `UPDATE.bat -NoBump`.

## Trying a change before building (faster)

From `zyne-app\`:
- `pnpm tauri dev`: laptop app with live reload
- `pnpm tauri android dev`: on the phone over USB (USB debugging on)
- `pnpm dev`: browser preview, good for looks only (no files, no AI)

## When it fails

- Red error during the build: copy the **first** red lines to Claude.
- Phone says "App not installed": the old APK was signed differently. Uninstall Zyne once,
  then install the new one (export a backup in Companion first if you want your journal).
- Never commit `apikey.txt` or anything in `src-tauri\gen\` (the signing key lives there).
  `.gitignore` already blocks them.
