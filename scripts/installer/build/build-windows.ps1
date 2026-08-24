<#
.SYNOPSIS
    Build the Windows one-shot installer: a single PyInstaller onefile.

.DESCRIPTION
    Installs build dependencies, locates the VSIX, and freezes the PyQt
    wizard with PyInstaller directly into the repo-root dist/ as
    NexusSetup.exe -- the user-facing distributable. v1.9.0 Phase 1 (T102)
    dropped the NSIS outer shell and the two-artifact/deep-path build: the
    onefile IS the installer, so double-clicking it opens exactly one modern
    branded window (no generic pre-wizard dialog). Optionally signs the exe.

.PARAMETER SkipSign
    Skip the signtool step (CI runners have no certificate).
#>
[CmdletBinding()]
param(
    [switch]$SkipSign
)

$ErrorActionPreference = 'Stop'
$InstallerRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path "$InstallerRoot\..\..").Path
$DistDir  = Join-Path $RepoRoot "dist"

Write-Host "[1/5] Installing build dependencies..." -ForegroundColor Cyan
Push-Location $InstallerRoot
uv sync --quiet
uv pip install pyinstaller --quiet
Pop-Location

# v2.2.0 Phase 8 (DF-7) / v2.2.5 Phase 5: build the bundled Nexus-Hub
# catalog snapshot from the LATEST tag. A stale local catalog (the 3.12.0
# class) fails the snapshot job; the installer still builds and syncs latest
# at install time. Do not embed a frozen snapshot.
Write-Host "[2/5] Building Nexus-Hub catalog snapshot..." -ForegroundColor Cyan
$HubCatalog = Join-Path $env:USERPROFILE ".nexus-ai\catalog"
$SnapshotOut = Join-Path $PSScriptRoot "hub-snapshot"
if (Test-Path $HubCatalog) {
    python (Join-Path $PSScriptRoot "build-hub-snapshot.py") --catalog $HubCatalog --out $SnapshotOut
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Snapshot pack refused (catalog is not latest, or latest tag unresolved). Clearing any stale snapshot." -ForegroundColor Yellow
        if (Test-Path $SnapshotOut) { Remove-Item $SnapshotOut -Recurse -Force }
    } else {
        Write-Host "  Snapshot built from $HubCatalog"
    }
} else {
    Write-Host "  No local catalog at $HubCatalog; installer will sync at install time." -ForegroundColor Yellow
}

Write-Host "[3/5] Locating artifacts..." -ForegroundColor Cyan
$Version = (Get-Content "$RepoRoot\package.json" | ConvertFrom-Json).version
Write-Host "  Version: $Version"
# vsce emits nexus-coding-*.vsix (the root package name); the legacy
# gemma-code-*.vsix glob is a fallback until the NAME.P1.A compat sweep.
$Vsix = $null
foreach ($pattern in @("nexus-coding-*.vsix", "gemma-code-*.vsix")) {
    foreach ($dir in @($RepoRoot, "$RepoRoot\scripts\installer")) {
        if (-not $Vsix) {
            $Vsix = Get-ChildItem "$dir\$pattern" -ErrorAction SilentlyContinue |
                Select-Object -First 1
        }
    }
}
if ($Vsix) {
    Write-Host "  VSIX: $($Vsix.FullName)"
} else {
    Write-Host "  WARNING: No VSIX found. Installer will not bundle the extension." -ForegroundColor Yellow
}

# v1.11.0 Phase 4 (T401): stage the desktop-app bundle for embedding. The
# installer no longer fetches the desktop app from GitHub releases at install
# time (that 404'd whenever a release shipped without binary assets); the NSIS
# bundle is embedded in the onefile instead. FAIL CLOSED: the bundle version
# must equal the product version (COORD.2), and a missing bundle stops the
# build -- a NexusSetup.exe without the desktop app is not shippable.
#
# Search order:
#   1. Local `tauri build` output (productName + version).
#   2. Canonical release artifact name next to the repo root (release.yml
#      downloads desktop-bundle-windows here).
#   3. A desktop-bundle-windows/ folder from actions/download-artifact.
$BundleCandidates = @(
    (Join-Path $RepoRoot "desktop\src-tauri\target\release\bundle\nsis\Nexus AI Studio_${Version}_x64-setup.exe"),
    (Join-Path $RepoRoot "Nexus-Desktop_${Version}_x64-setup.exe"),
    (Join-Path $RepoRoot "desktop-bundle-windows\Nexus-Desktop_${Version}_x64-setup.exe")
)
$DesktopBundle = $BundleCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $DesktopBundle) {
    Write-Host "ERROR: desktop bundle not found for product version ${Version}:" -ForegroundColor Red
    foreach ($candidate in $BundleCandidates) {
        Write-Host "  $candidate" -ForegroundColor Red
    }
    Write-Host "  Build it first: cd desktop; npm run build:shell" -ForegroundColor Red
    Write-Host "  Or download the desktop-bundle-windows artifact next to package.json." -ForegroundColor Red
    exit 1
}
$PayloadDir = Join-Path $InstallerRoot "build\desktop-payload"
New-Item -ItemType Directory -Force -Path $PayloadDir | Out-Null
$StagedBundle = Join-Path $PayloadDir "Nexus-Desktop-Setup.exe"
Copy-Item $DesktopBundle $StagedBundle -Force
$BundleHash = (Get-FileHash $StagedBundle -Algorithm SHA256).Hash.ToLower()
@{
    filename      = "Nexus-Desktop-Setup.exe"
    original_name = (Split-Path $DesktopBundle -Leaf)
    version       = $Version
    sha256        = $BundleHash
    platform      = "win32"
} | ConvertTo-Json | Set-Content (Join-Path $PayloadDir "manifest.json") -Encoding ascii
Write-Host "  Desktop bundle staged: $(Split-Path $DesktopBundle -Leaf) (sha256 $($BundleHash.Substring(0,12))...)"

# The onefile is written straight to the repo-root dist/ (gitignored) so the
# canonical local output is easy to find -- no deep pyqt/dist + hand-copy.
Write-Host "[4/5] Running PyInstaller (single onefile -> dist/NexusSetup.exe)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
Push-Location $InstallerRoot

# v1.11.0 Phase 1 (T104): surface placeholder HF weight pins as a build
# warning -- a placeholder pin makes the installer skip hash verification for
# that download. The check logs to stderr, so route it to a file under the
# PS 5.1 EAP=Stop discipline (same rationale as the PyInstaller block below).
$PinLog = Join-Path $DistDir "pin-check.log"
$PrevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
uv run python build/pin-hf-weights.py --check > $PinLog 2>&1
$PinExit = $LASTEXITCODE
$ErrorActionPreference = $PrevEAP
if ($PinExit -ne 0) {
    Write-Host "  WARNING: placeholder HF weight pins remain; those downloads skip hash verification. See $PinLog." -ForegroundColor Yellow
}
# PyInstaller writes its entire progress log to stderr. Under Windows
# PowerShell 5.1, merging that into the pipeline (2>&1) wraps each line in a
# NativeCommandError record, and with $ErrorActionPreference='Stop' (set at the
# top) the first such line aborts the build before it can finish. Send stderr
# to a log file instead: the console stays clean, nothing is promoted to a
# terminating error, and $LASTEXITCODE still carries PyInstaller's real exit
# code. Works on PowerShell 5.1 and 7+. The log is kept for debugging.
$BuildLog = Join-Path $DistDir "pyinstaller-build.log"
$PrevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
uv run pyinstaller build/nexus-installer.spec --distpath "$DistDir" --workpath build/work --clean --noconfirm 2> $BuildLog
$PyiExit = $LASTEXITCODE
$ErrorActionPreference = $PrevEAP
Pop-Location

if ($PyiExit -ne 0) {
    Write-Host "ERROR: PyInstaller exited with code $PyiExit. See $BuildLog." -ForegroundColor Red
    exit 1
}

$ExePath = Join-Path $DistDir "NexusSetup.exe"
if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: PyInstaller failed. $ExePath not found." -ForegroundColor Red
    exit 1
}

Write-Host "[5/5] Build output:" -ForegroundColor Cyan
$FileSize = (Get-Item $ExePath).Length / 1MB
$Hash = (Get-FileHash $ExePath -Algorithm SHA256).Hash
Write-Host "  File: $ExePath"
Write-Host "  Size: $([math]::Round($FileSize, 1)) MB"
Write-Host "  SHA256: $Hash"

if (-not $SkipSign) {
    Write-Host "Signing (if certificate available)..." -ForegroundColor Cyan
    $SignTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($SignTool) {
        & signtool.exe sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a $ExePath 2>&1 |
            ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  Skipped: signtool not found." -ForegroundColor Yellow
    }
} else {
    Write-Host "Signing skipped (--SkipSign)." -ForegroundColor Yellow
}

Write-Host "`nBuild complete: $ExePath" -ForegroundColor Green
