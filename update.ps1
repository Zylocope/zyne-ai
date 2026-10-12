# -------------------------------------------------------------
#  Zyne - build new installers for laptop and phone.
#  Double-click UPDATE.bat (it runs this), or in PowerShell:
#     .\update.ps1                 both apps, version goes up by one (0.1.2 -> 0.1.3)
#     .\update.ps1 -Only desktop   laptop installer only
#     .\update.ps1 -Only phone     phone APK only
#     .\update.ps1 -NoBump         rebuild without changing the version
#  Results land in .\releases\ ; older builds move to .\releases\old\
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

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`nSTOPPED: $msg" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

# -- 1. version -----------------------------------------------
$pkgPath   = Join-Path $app 'package.json'
$confPath  = Join-Path $app 'src-tauri\tauri.conf.json'
$cargoPath = Join-Path $app 'src-tauri\Cargo.toml'
$version   = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
if (-not $NoBump) {
  $p = $version.Split('.')
  $new = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
  Step "Version $version -> $new"
  foreach ($f in $pkgPath, $confPath) {
    $t = Get-Content $f -Raw
    $t = $t -replace "`"version`":\s*`"$([regex]::Escape($version))`"", "`"version`": `"$new`""
    [IO.File]::WriteAllText($f, $t)
  }
  $c = Get-Content $cargoPath -Raw
  $re = [regex]"(?m)^version = `"$([regex]::Escape($version))`""
  $c = $re.Replace($c, "version = `"$new`"", 1)   # first match = the [package] version
  [IO.File]::WriteAllText($cargoPath, $c)
  $version = $new
} else { Step "Rebuilding version $version" }

# -- 2. self-check (fast; stops a broken build early) ---------
Step 'Self-check'
Push-Location $app
try {
  node src/js/focus-library.test.js
  if ($LASTEXITCODE -ne 0) { Fail 'self-check failed. Nothing was built.' }
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { pnpm install }

  # move the previous builds of the same kind to old\
  function Retire($pattern) {
    Get-ChildItem $releases -File -Filter $pattern | ForEach-Object { Move-Item $_.FullName $old -Force }
  }

  # -- 3. laptop installer ------------------------------------
  if ($Only -in 'both', 'desktop') {
    Step 'Building the laptop installer (5-10 min)'
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { Fail 'laptop build failed (scroll up for the first red error).' }
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
    pnpm tauri android build --apk --target aarch64
    if ($LASTEXITCODE -ne 0) { Fail 'phone build failed (scroll up for the first red error).' }
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
