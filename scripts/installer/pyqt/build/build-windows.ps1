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
$PyqtRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path "$PyqtRoot\..\..\..").Path
$DistDir  = Join-Path $RepoRoot "dist"

Write-Host "[1/4] Installing build dependencies..." -ForegroundColor Cyan
Push-Location $PyqtRoot
uv sync --quiet
uv pip install pyinstaller --quiet
Pop-Location

Write-Host "[2/4] Locating artifacts..." -ForegroundColor Cyan
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

# The onefile is written straight to the repo-root dist/ (gitignored) so the
# canonical local output is easy to find -- no deep pyqt/dist + hand-copy.
Write-Host "[3/4] Running PyInstaller (single onefile -> dist/NexusSetup.exe)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
Push-Location $PyqtRoot
uv run pyinstaller build/nexus-installer.spec --distpath "$DistDir" --workpath build/work --clean --noconfirm 2>&1 |
    Select-String -NotMatch "^(INFO|DEBUG)" | ForEach-Object { $_.Line }
Pop-Location

$ExePath = Join-Path $DistDir "NexusSetup.exe"
if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: PyInstaller failed. $ExePath not found." -ForegroundColor Red
    exit 1
}

Write-Host "[4/4] Build output:" -ForegroundColor Cyan
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
