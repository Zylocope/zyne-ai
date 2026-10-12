# -------------------------------------------------------------
#  Zyne - build new installers for laptop and phone.
#  Double-click UPDATE.bat (it runs this), or in PowerShell:
#     .\update.ps1                 both apps, version goes up by one (2.0.0 -> 2.0.1)
#     .\update.ps1 -Only desktop   laptop installer only
#     .\update.ps1 -Only phone     phone APK only
#     .\update.ps1 -NoBump         rebuild without changing the version
#  Results land in .\releases\ ; older builds move to .\releases\old\
#  Everything printed is also saved to .\releases\update-log.txt
#  (so Claude can read what went wrong).
# -------------------------------------------------------------
param(
  [ValidateSet('both', 'desktop', 'phone')] [string] $Only = 'both',
  [switch] $NoBump
)
$ErrorActionPreference = 'Stop'
$root     = $PSScriptRoot
$app      = Join-Path $root 'zyne-app'
$releases = Join-Path $root 'releases'
$old      = Join-Path $releases 'old'
New-Item -ItemType Directory -Force -Path $releases, $old | Out-Null
$log = Join-Path $releases 'update-log.txt'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($log, "Zyne update  $(Get-Date -Format 'yyyy-MM-dd HH:mm')  Only=$Only NoBump=$NoBump`r`n", $utf8)

function Log($msg) { [IO.File]::AppendAllText($log, "$msg`r`n", $utf8) }
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan; Log "`r`n== $msg" }
function Fail($msg) {
  Write-Host "`nSTOPPED: $msg" -ForegroundColor Red
  Write-Host "Full output: releases\update-log.txt" -ForegroundColor Yellow
  Log "`r`nSTOPPED: $msg"
  Read-Host 'Press Enter to close'; exit 1
}
# Run a command, show its output live and copy every line into the log.
function Run([string] $cmd) {
  Log "> $cmd"
  cmd /c "$cmd 2>&1" | ForEach-Object { Write-Host $_; Log $_ }
  return $LASTEXITCODE
}
# Read/write as UTF-8 so non-English characters survive (Windows PowerShell 5 would not).
function ReadText($f) { [IO.File]::ReadAllText($f, $utf8) }
function WriteText($f, $t) { [IO.File]::WriteAllText($f, $t, $utf8) }

# -- 1. version -----------------------------------------------
$pkgPath   = Join-Path $app 'package.json'
$confPath  = Join-Path $app 'src-tauri\tauri.conf.json'
$cargoPath = Join-Path $app 'src-tauri\Cargo.toml'
$version   = (ReadText $pkgPath | ConvertFrom-Json).version
if (-not $NoBump) {
  $p = $version.Split('.')
  $new = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
  Step "Version $version -> $new"
  foreach ($f in $pkgPath, $confPath) {
    $t = (ReadText $f) -replace "`"version`":\s*`"$([regex]::Escape($version))`"", "`"version`": `"$new`""
    WriteText $f $t
  }
  $re = [regex]"(?m)^version = `"$([regex]::Escape($version))`""
  WriteText $cargoPath ($re.Replace((ReadText $cargoPath), "version = `"$new`"", 1))   # first match = [package]
  $version = $new
} else { Step "Rebuilding version $version" }

# -- 2. self-check + packages ---------------------------------
Step 'Self-check'
Push-Location $app
try {
  if ((Run 'node src/js/focus-library.test.js') -ne 0) { Fail 'self-check failed. Nothing was built.' }
  Step 'Installing packages'
  if ((Run 'pnpm install --frozen-lockfile') -ne 0) {
    if ((Run 'pnpm install') -ne 0) {
      Fail 'package install failed. Close Zyne, VS Code terminals and any "pnpm dev", then try again.'
    }
  }

  # move the previous builds of the same kind to old\
  function Retire($pattern) {
    Get-ChildItem $releases -File -Filter $pattern | ForEach-Object { Move-Item $_.FullName $old -Force }
  }

  # -- 3. laptop installer ------------------------------------
  if ($Only -in 'both', 'desktop') {
    Step 'Building the laptop installer (5-10 min)'
    if ((Run 'pnpm tauri build') -ne 0) { Fail 'laptop build failed.' }
    $exe = Get-ChildItem (Join-Path $app 'src-tauri\target\release\bundle\nsis') -Filter "*_${version}_x64-setup.exe" |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $exe) { Fail 'build finished but no installer was found.' }
    Retire 'Zyne-*-setup.exe'
    Copy-Item $exe.FullName (Join-Path $releases "Zyne-$version-setup.exe")
    Write-Host "  -> releases\Zyne-$version-setup.exe" -ForegroundColor Green
  }

  # -- 4. phone APK -------------------------------------------
  if ($Only -in 'both', 'phone') {
    Step 'Building the phone APK (5-15 min)'
    $since = Get-Date
    if ((Run 'pnpm tauri android build --apk --target aarch64') -ne 0) { Fail 'phone build failed.' }
    $apk = Get-ChildItem (Join-Path $app 'src-tauri\gen\android\app\build\outputs\apk') -Recurse -Filter '*release*.apk' |
           Where-Object { $_.LastWriteTime -ge $since } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $apk) { Fail 'build finished but no signed release APK was found.' }
    Retire 'Zyne-*.apk'
    Copy-Item $apk.FullName (Join-Path $releases "Zyne-$version.apk")
    Write-Host "  -> releases\Zyne-$version.apk" -ForegroundColor Green
  }
} finally { Pop-Location }

Step "Done: Zyne $version"
Write-Host @"
  Laptop: run releases\Zyne-$version-setup.exe  (it updates the installed app; your data stays)
  Phone:  send releases\Zyne-$version.apk to the phone (USB, Telegram Saved Messages, or Drive),
          tap it, choose Update. Your journal and settings stay.
  Then commit:  git add -A ; git commit -m "Zyne $version" ; git push
"@
Start-Process explorer.exe $releases
Read-Host 'Press Enter to close'
