<#
.SYNOPSIS
    Build the Nexus Installer as a single Windows .exe via PyInstaller.

.DESCRIPTION
    Installs build dependencies, copies required artifacts, runs PyInstaller,
    and optionally signs the output. Produces dist/NexusSetup.exe.
#>
[CmdletBinding()]
param(
    [switch]$SkipSign
)

$ErrorActionPreference = 'Stop'
$PyqtRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path "$PyqtRoot\..\..\..").Path

Write-Host "[1/5] Installing build dependencies..." -ForegroundColor Cyan
Push-Location $PyqtRoot
uv sync --quiet
uv pip install pyinstaller --quiet
Pop-Location

Write-Host "[2/5] Locating artifacts..." -ForegroundColor Cyan
$Version = (Get-Content "$RepoRoot\package.json" | ConvertFrom-Json).version
$Vsix = Get-ChildItem "$RepoRoot\gemma-code-*.vsix" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $Vsix) {
    $Vsix = Get-ChildItem "$RepoRoot\scripts\installer\gemma-code-*.vsix" -ErrorAction SilentlyContinue |
        Select-Object -First 1
}
if ($Vsix) {
    Write-Host "  VSIX: $($Vsix.FullName)"
} else {
    Write-Host "  WARNING: No VSIX found. Installer will not bundle the extension." -ForegroundColor Yellow
}

Write-Host "[3/5] Running PyInstaller..." -ForegroundColor Cyan
Push-Location $PyqtRoot
uv run pyinstaller build/nexus-installer.spec --distpath dist --workpath build/work --clean --noconfirm 2>&1 |
    Select-String -NotMatch "^(INFO|DEBUG)" | ForEach-Object { $_.Line }
Pop-Location

$ExePath = "$PyqtRoot\dist\NexusSetup.exe"
if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: Build failed. $ExePath not found." -ForegroundColor Red
    exit 1
}

Write-Host "[4/5] Build output:" -ForegroundColor Cyan
$FileSize = (Get-Item $ExePath).Length / 1MB
$Hash = (Get-FileHash $ExePath -Algorithm SHA256).Hash
Write-Host "  File: $ExePath"
Write-Host "  Size: $([math]::Round($FileSize, 1)) MB"
Write-Host "  SHA256: $Hash"

if (-not $SkipSign) {
    Write-Host "[5/5] Signing (if certificate available)..." -ForegroundColor Cyan
    $SignTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($SignTool) {
        & signtool.exe sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a $ExePath 2>&1 |
            ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  Skipped: signtool not found." -ForegroundColor Yellow
    }
} else {
    Write-Host "[5/5] Signing skipped (--SkipSign)." -ForegroundColor Yellow
}

Write-Host "`nBuild complete: $ExePath" -ForegroundColor Green
