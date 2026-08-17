# Zyne.AI — v1.0 Setup Guide

This covers everything you need to run the desktop app, enable reminder notifications, and bootstrap the mobile build.

---

## 1 · Desktop (you already have this working)

```powershell
# Prereqs: Node 18+, pnpm, Rust (via rustup), Ollama
pnpm install
pnpm tauri dev
```

Ollama + model:

```powershell
# Install Ollama (from ollama.com), then pull the fast model
ollama pull qwen3:0.6b

# One-time CORS fix so the Tauri webview can call Ollama
setx OLLAMA_ORIGINS "*"
# Restart PowerShell, then:
ollama serve
```

The app will auto-pick `qwen3:0.6b` from your installed models. Preference order is defined in `src/js/ollama.js`.

---

## 2 · Reminder notifications (required for the ⏰ feature)

The calendar saves `notify_minutes` on each event. To make actual OS notifications fire, add Tauri's notification plugin.

### Install the plugin

```powershell
# From zyne-app/
pnpm add @tauri-apps/plugin-notification@^2
cd src-tauri
cargo add tauri-plugin-notification --features "notification"
```

### Register it in Rust

Open `src-tauri/src/lib.rs` and add the plugin to the builder. Find the `tauri::Builder::default()` chain and add:

```rust
.plugin(tauri_plugin_notification::init())
```

So the builder block looks like:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_notification::init())   // ← add this
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

### Grant permissions in the capabilities file

Open `src-tauri/capabilities/default.json` and add:

```json
"notification:default"
```

to the `permissions` array.

### Verify

Run `pnpm tauri dev`, create an event 2 minutes in the future with a 1-minute notify, wait. A system notification should pop up. If the plugin isn't installed, the app falls back to the browser `Notification` API silently — no error, just less polished.

---

## 3 · Mobile (Android — Windows build workflow)

Budget roughly 1-2 hours for the first-time setup and about 15 GB of disk. Once it's done, day-to-day dev rebuilds take under a minute.

### 3.1 · Install Android Studio

Download from https://developer.android.com/studio and run the installer. On first launch, the Setup Wizard appears:

- Choose **Standard** install type (auto-downloads the base SDK).
- Note the SDK location it shows you — on Windows the default is `%LOCALAPPDATA%\Android\Sdk`.
- Accept every license agreement (several walls of text — scroll, click Accept).

### 3.2 · Install the specific SDK components Tauri needs

From the Welcome screen: **More Actions → SDK Manager**.

In **SDK Platforms** tab, check:
- **Android 14.0 (UpsideDownCake) — API Level 34** (or newer if available)

In **SDK Tools** tab, tick **"Show Package Details"** at the bottom-right, then install:
- **NDK (Side by side)** — pick the latest `26.x.x`
- **Android SDK Build-Tools** — latest
- **Android SDK Platform-Tools** (this is where `adb` comes from)
- **Android SDK Command-line Tools (latest)**
- **CMake** — latest

Click **Apply**, accept licenses, wait for ~4-5 GB to download.

### 3.3 · Find your exact NDK version number

The `<ndk-version>` placeholder in step 3.4 is not literal — replace it with the actual folder name. Open File Explorer at:

```
%LOCALAPPDATA%\Android\Sdk\ndk
```

You'll see a folder like `26.1.10909125`. Write that exact string down.

### 3.4 · Set environment variables

In a fresh PowerShell window (not admin), replacing the NDK version with yours:

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx NDK_HOME "$env:LOCALAPPDATA\Android\Sdk\ndk\26.1.10909125"
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
```

Close every PowerShell window, reopen a new one, then verify:

```powershell
echo $env:ANDROID_HOME
echo $env:NDK_HOME
echo $env:JAVA_HOME
```

All three must print a real path. If `JAVA_HOME` is empty, your Android Studio may live at `C:\Program Files\Android\Android Studio 2024.x\jbr` — find the actual `jbr` folder and redo the `setx`.

### 3.5 · Install Rust's Android compile targets

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Four architectures: modern 64-bit phones, older 32-bit phones, and both x86 emulator variants.

### 3.6 · Pick your test device: real phone or emulator

**Option A — Real phone (recommended).** Faster than the emulator, uses no extra disk.

On the phone:

1. Settings → About phone → tap **Build number** 7 times (developer-mode easter egg).
2. Settings → System → **Developer options** → enable **USB debugging**.
3. Plug the phone into your PC via USB.
4. When the phone asks "Allow USB debugging from this computer?" tap **Always allow**, then OK.

Verify from PowerShell:

```powershell
adb devices
```

Should list your phone as `XXXXXXXX  device`. If it says `unauthorized`, re-accept the prompt on the phone.

**Option B — Emulator.** No phone needed, uses ~4 GB.

In Android Studio's Welcome screen: **More Actions → Virtual Device Manager** → **Create Device** → pick "Pixel 7" → Next → pick Android 14 system image (download if needed) → Next → Finish. Press the ▶ play icon to boot. First boot takes 1-3 minutes.

### 3.7 · Initialize the Tauri Android project (one time)

```powershell
cd <path-to-repo>\zyne-app
pnpm tauri android init
```

This generates `src-tauri/gen/android/` — the actual Android project. You shouldn't need to edit anything inside. If you're using git, add `src-tauri/gen/android/` to `.gitignore`, especially any `.keystore` file.

### 3.8 · First dev run

With phone connected (or emulator running):

```powershell
pnpm tauri android dev
```

**First-run warnings that are normal**, do not cancel:

- Gradle downloads ~2 GB of Java dependencies. You'll see progress bars that appear stuck at "Configuring project" for 3-5 minutes.
- Walls of scrolling build output.
- Eventually a `BUILD SUCCESSFUL` line, then the app installs and launches on your phone/emulator.

After the first run, subsequent `tauri android dev` starts take 20-40 seconds.

Live-reload works: JS/CSS/HTML edits refresh on the phone while the dev command is running. Rust edits trigger a rebuild.

### 3.9 · Build a release APK

```powershell
pnpm tauri android build
```

Output file:

```
src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk
```

Or for the Play Store bundle format:

```
src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
```

**Signing:** Tauri auto-generates a debug keystore so the APK installs immediately. For Play Store publishing you need a real release keystore — see https://v2.tauri.app/distribute/sign/android. For sideloading to your own phone, debug-signed is fine.

To install on a phone manually: copy the APK over (email, Drive, USB), open it on the phone, allow "Install unknown apps" when prompted.

### 3.10 · Common errors and fixes

| Error | Fix |
|-------|-----|
| `SDK location not found` | `ANDROID_HOME` isn't set in the current shell. Close PowerShell, reopen, re-check with `echo $env:ANDROID_HOME`. |
| `NDK not configured` | `NDK_HOME` points at a folder that doesn't exist. The version in the path must match the folder name exactly. |
| `No connected devices` | Emulator not running, or phone shows `unauthorized` in `adb devices`. Unplug/replug USB and re-accept the prompt. |
| Gradle hangs at "Downloading..." 30+ min | Slow network, but usually still progressing. If truly stuck: `cd src-tauri/gen/android && .\gradlew.bat --stop` then retry. |
| APK launches but crashes / shows white screen | Mobile version can't reach `http://localhost:11434` because Ollama runs on your desktop. Expected for v1.0 desktop-only inference. Mobile inference needs a separate plan (cloud API, on-device small model, or LAN bridge to desktop Ollama) — a task for after v1.0 desktop ships. |

---

## 4 · What's already mobile-friendly

The app's CSS was pre-passed for small screens:

- Touch targets enlarged under `@media (pointer: coarse)`
- Layout breakpoints at 560px for phone widths (360-430px)
- Day-timeline events have minimum heights so they're tappable
- Mini-month cells use `aspect-ratio: 1/1` so they stay square at any width

You may still want to tune once testing on a real device — look for overflow on the News ticker and the bot strip, which are horizontally scrolling.

---

## 5 · App icon for mobile builds

Generate PNG icons from the SVG source when you're ready to build for stores:

```powershell
# Using Tauri's built-in icon generator:
pnpm tauri icon src/assets/zyne-icon.svg
```

This fills out `src-tauri/icons/` (including Android `mipmap-*` and iOS `AppIcon.appiconset`) from a single 1024×1024 source. The SVG at `src/assets/zyne-icon.svg` is 512×512; if you want a sharper export, render it once to a 1024 PNG first with any vector tool.

---

## 6 · Quick build checklist for v1.0 ship

- [ ] `pnpm install` passes clean
- [ ] `pnpm tauri build` produces a working .msi / .exe
- [ ] `ollama pull qwen3:0.6b` tested on a fresh machine
- [ ] Notification plugin wired, reminder fires on a test event
- [ ] `pnpm tauri android init` + first APK builds
- [ ] Icon regenerated from `src/assets/zyne-icon.svg`
- [ ] README updated with install instructions for non-dev users
