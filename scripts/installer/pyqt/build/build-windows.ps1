<#
.SYNOPSIS
    Build the Windows one-shot installer: PyInstaller wizard + NSIS outer.

.DESCRIPTION
    Installs build dependencies, locates the VSIX, freezes the PyQt wizard
    with PyInstaller (dist/nexus-installer.exe), compiles the NSIS outer
    shell (dist/NexusSetup.exe -- the user-facing artifact), and optionally
    signs the output. v1.8.0 Phase 6 (T601) added the NSIS step; the wizard
    exe is no longer the distributable.

.PARAMETER SkipSign
    Skip the signtool step (CI runners have no certificate).

.PARAMETER PayloadDir
    Optional absolute path to a pre-fetched build/payload tree to embed for
    offline installs (passed to NSIS as /DPAYLOAD_DIR). Default: none -- the
    wizard downloads everything at install time.
#>
[CmdletBinding()]
param(
    [switch]$SkipSign,
    [string]$PayloadDir
)

$ErrorActionPreference = 'Stop'
$PyqtRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path "$PyqtRoot\..\..\..").Path

Write-Host "[1/6] Installing build dependencies..." -ForegroundColor Cyan
Push-Location $PyqtRoot
uv sync --quiet
uv pip install pyinstaller --quiet
Pop-Location

Write-Host "[2/6] Locating artifacts..." -ForegroundColor Cyan
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

Write-Host "[3/6] Running PyInstaller (wizard)..." -ForegroundColor Cyan
Push-Location $PyqtRoot
uv run pyinstaller build/nexus-installer.spec --distpath dist --workpath build/work --clean --noconfirm 2>&1 |
    Select-String -NotMatch "^(INFO|DEBUG)" | ForEach-Object { $_.Line }
Pop-Location

$WizardPath = "$PyqtRoot\dist\nexus-installer.exe"
if (-not (Test-Path $WizardPath)) {
    Write-Host "ERROR: PyInstaller failed. $WizardPath not found." -ForegroundColor Red
    exit 1
}

Write-Host "[4/6] Compiling NSIS outer shell..." -ForegroundColor Cyan
$MakeNsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
if (-not (Test-Path $MakeNsis)) {
    $MakeNsisCmd = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($MakeNsisCmd) { $MakeNsis = $MakeNsisCmd.Source }
}
if (-not (Test-Path $MakeNsis)) {
    Write-Host "ERROR: makensis.exe not found. Install NSIS (choco install nsis -y)." -ForegroundColor Red
    exit 1
}
$NsiScript = "$RepoRoot\scripts\installer\build\nsis\nexus-setup.nsi"
$NsisArgs = @("/DAPP_VERSION=$Version")
if ($PayloadDir) {
    $NsisArgs += "/DPAYLOAD_DIR=$((Resolve-Path $PayloadDir).Path)"
    Write-Host "  Embedding payload from $PayloadDir"
}
& $MakeNsis @NsisArgs $NsiScript 2>&1 |
    Select-String -NotMatch "^(File:|Extract:)" | ForEach-Object { "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: makensis failed (exit $LASTEXITCODE)." -ForegroundColor Red
    exit 1
}

$ExePath = "$PyqtRoot\dist\NexusSetup.exe"
if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: Build failed. $ExePath not found." -ForegroundColor Red
    exit 1
}

Write-Host "[5/6] Build output:" -ForegroundColor Cyan
foreach ($artifact in @($ExePath, $WizardPath)) {
    $FileSize = (Get-Item $artifact).Length / 1MB
    $Hash = (Get-FileHash $artifact -Algorithm SHA256).Hash
    Write-Host "  File: $artifact"
    Write-Host "  Size: $([math]::Round($FileSize, 1)) MB"
    Write-Host "  SHA256: $Hash"
}

if (-not $SkipSign) {
    Write-Host "[6/6] Signing (if certificate available)..." -ForegroundColor Cyan
    $SignTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($SignTool) {
        & signtool.exe sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a $ExePath 2>&1 |
            ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  Skipped: signtool not found." -ForegroundColor Yellow
    }
} else {
    Write-Host "[6/6] Signing skipped (--SkipSign)." -ForegroundColor Yellow
}

# Convenience copy: surface the final artifact at the repo root (dist/ is
# gitignored) so local builds are easy to find; CI keeps uploading from the
# canonical PyInstaller location next to the spec.
$RootDist = Join-Path $RepoRoot "dist"
New-Item -ItemType Directory -Force -Path $RootDist | Out-Null
Copy-Item -Force $ExePath (Join-Path $RootDist "NexusSetup.exe")

Write-Host "`nBuild complete: $RootDist\NexusSetup.exe" -ForegroundColor Green
Write-Host "  (canonical CI path: $ExePath)" -ForegroundColor Green
