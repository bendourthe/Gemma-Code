<#
.SYNOPSIS
    Packaging smoke for NexusSetup.exe: assert a single artifact, then boot it.

.DESCRIPTION
    v1.9.0 Phase 1 (T105): the NSIS outer shell is gone -- the PyInstaller
    onefile IS the distributable. This smoke asserts exactly one installer
    artifact was produced (NexusSetup.exe, and no leftover nexus-installer.exe
    two-artifact wizard), then boots the frozen exe twice without provisioning:
    --version for a bootloader probe, and --check-registry to assert the
    bundled catalog.json / recommended.json resolve inside the frozen bundle
    (the OSI004.P4.C regression guard). Both flags are handled before Qt loads,
    so the windowed exe runs them headless and exits with a code. The full
    provisioning flow is covered by tests/smoke/smoke-windows.ps1 (headless,
    source mode) and the Phase 6 clean-VM rehearsal.

    Exits 0 when every assertion passes.
#>
[CmdletBinding()]
param(
    [string]$ExePath = (Join-Path (Resolve-Path "$PSScriptRoot\..\..\..").Path "dist\NexusSetup.exe"),
    [string]$DistDir = (Resolve-Path "$PSScriptRoot\..\..\..").Path
)

$ErrorActionPreference = 'Stop'
$failures = @()

function Assert-True {
    param([bool]$Condition, [string]$Label)
    if ($Condition) {
        Write-Host "  PASS  $Label"
    } else {
        Write-Host "  FAIL  $Label" -ForegroundColor Red
        $script:failures += $Label
    }
}

if (-not (Test-Path $ExePath)) {
    Write-Host "ERROR: $ExePath not found. Run build-windows.ps1 first." -ForegroundColor Red
    exit 1
}

$Dist = Join-Path $DistDir "dist"

Write-Host "==> Single-artifact assertions"
Assert-True (Test-Path $ExePath) "NexusSetup.exe present at $ExePath"
# The NSIS-era build emitted a second nexus-installer.exe wizard; assert the
# two-artifact confusion is gone.
$strayWizard = Join-Path $Dist "nexus-installer.exe"
Assert-True (-not (Test-Path $strayWizard)) "no leftover nexus-installer.exe two-artifact wizard"

Write-Host "==> Wizard boot probe (--version)"
$proc = Start-Process -FilePath $ExePath -ArgumentList "--version" -Wait -PassThru
Assert-True ($proc.ExitCode -eq 0) "NexusSetup.exe --version exit code 0 (got $($proc.ExitCode))"

Write-Host "==> Bundled registry probe (--check-registry)"
$proc = Start-Process -FilePath $ExePath -ArgumentList "--check-registry" -Wait -PassThru
Assert-True ($proc.ExitCode -eq 0) "NexusSetup.exe --check-registry exit code 0 (got $($proc.ExitCode))"

if ($failures.Count -gt 0) {
    Write-Host "`nSmoke FAILED: $($failures.Count) assertion(s)." -ForegroundColor Red
    exit 1
}
Write-Host "`nSmoke passed." -ForegroundColor Green
