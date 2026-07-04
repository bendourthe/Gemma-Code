<#
.SYNOPSIS
    Packaging smoke for NexusSetup.exe: silent install, probe, silent uninstall.

.DESCRIPTION
    Exercises the NSIS outer shell end-to-end without provisioning anything
    (v1.8.0 Phase 6, T601): installs silently into a scratch directory,
    asserts the frozen wizard extracted, boots the wizard twice (--version
    for a bootloader probe, --check-registry to assert the bundled
    catalog.json / recommended.json resolve -- the OSI004.P4.C regression
    guard), then uninstalls silently and asserts cleanup. The full
    provisioning flow is covered by tests/smoke/smoke-windows.ps1 (headless,
    source mode) and the T602 clean-VM rehearsal.

    Exits 0 when every assertion passes.
#>
[CmdletBinding()]
param(
    [string]$ExePath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) "dist\NexusSetup.exe"),
    [string]$Scratch = (Join-Path $env:TEMP "nexus-setup-smoke")
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
if (Test-Path $Scratch) {
    Remove-Item -Recurse -Force $Scratch
}

Write-Host "==> Silent install to $Scratch"
# NSIS: /S = silent, /D= must be last and unquoted (no-space paths only).
$proc = Start-Process -FilePath $ExePath -ArgumentList "/S", "/D=$Scratch" -Wait -PassThru
Assert-True ($proc.ExitCode -eq 0) "silent install exit code 0 (got $($proc.ExitCode))"

$wizard = Join-Path $Scratch "nexus-installer.exe"
Assert-True (Test-Path $wizard) "wizard extracted to $wizard"
Assert-True (Test-Path (Join-Path $Scratch "Uninstall.exe")) "uninstaller written"

if (Test-Path $wizard) {
    Write-Host "==> Wizard boot probe (--version)"
    $proc = Start-Process -FilePath $wizard -ArgumentList "--version" -Wait -PassThru
    Assert-True ($proc.ExitCode -eq 0) "wizard --version exit code 0 (got $($proc.ExitCode))"

    Write-Host "==> Bundled registry probe (--check-registry)"
    $proc = Start-Process -FilePath $wizard -ArgumentList "--check-registry" -Wait -PassThru
    Assert-True ($proc.ExitCode -eq 0) "wizard --check-registry exit code 0 (got $($proc.ExitCode))"
}

Write-Host "==> Silent uninstall"
$uninstaller = Join-Path $Scratch "Uninstall.exe"
if (Test-Path $uninstaller) {
    # _?= makes the uninstaller run in place (no temp self-copy) so -Wait is
    # meaningful; the trade-off is Uninstall.exe cannot delete itself, so it
    # is removed here before asserting the directory is gone.
    $proc = Start-Process -FilePath $uninstaller -ArgumentList "/S", "_?=$Scratch" -Wait -PassThru
    Assert-True ($proc.ExitCode -eq 0) "silent uninstall exit code 0 (got $($proc.ExitCode))"
    Assert-True (-not (Test-Path $wizard)) "wizard removed by uninstaller"
    if (Test-Path $uninstaller) {
        Remove-Item -Force $uninstaller
    }
    if ((Test-Path $Scratch) -and -not (Get-ChildItem $Scratch)) {
        Remove-Item -Force $Scratch
    }
    Assert-True (-not (Test-Path $Scratch)) "install directory removed"
}

if ($failures.Count -gt 0) {
    Write-Host "`nSmoke FAILED: $($failures.Count) assertion(s)." -ForegroundColor Red
    exit 1
}
Write-Host "`nSmoke passed." -ForegroundColor Green
