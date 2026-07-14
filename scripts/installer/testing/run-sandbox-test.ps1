<#
.SYNOPSIS
    One-command clean-machine install test in Windows Sandbox.

.DESCRIPTION
    v1.11.0 Phase 2 (T201). Generates a .wsb from the template (mapping the
    repo's dist/ read-only, this testing/ folder read-only, and a fresh temp
    output folder writable), launches Windows Sandbox, polls for the
    result.json the in-sandbox bootstrap writes, prints a pass/fail summary,
    and exits with the smoke's status. The sandbox is a factory-fresh Windows
    on every boot - the exact machine a non-technical user runs the installer
    on.

.PARAMETER ProfileName
    Profile name under testing/profiles/ (default: sandbox-minimal).

.PARAMETER TimeoutSec
    How long to wait for the in-sandbox run to produce result.json.

.NOTES
    Requires Windows Sandbox (Windows 11 Pro; enable via "Turn Windows
    features on or off" -> Windows Sandbox). The sandbox window stays open
    for inspection; close it manually when done.
#>
[CmdletBinding()]
param(
    [string]$ProfileName = "sandbox-minimal",
    [int]$TimeoutSec = 1800
)

$ErrorActionPreference = 'Stop'
$TestingDir = $PSScriptRoot
$RepoRoot = (Resolve-Path "$TestingDir\..\..\..").Path
$DistDir = Join-Path $RepoRoot "dist"
$Exe = Join-Path $DistDir "NexusSetup.exe"
$Template = Join-Path $TestingDir "sandbox-config.wsb.template"

$Sandbox = Join-Path $env:WINDIR "System32\WindowsSandbox.exe"
if (-not (Test-Path $Sandbox)) {
    Write-Host "ERROR: Windows Sandbox is not available. Enable it via 'Turn Windows features on or off' -> Windows Sandbox (requires Win10/11 Pro with virtualization)." -ForegroundColor Red
    exit 2
}
if (-not (Test-Path $Exe)) {
    Write-Host "ERROR: $Exe not found. Build it first: pwsh scripts/installer/build/build-windows.ps1 -SkipSign" -ForegroundColor Red
    exit 2
}
if (-not (Test-Path (Join-Path $TestingDir "profiles\$ProfileName.json"))) {
    Write-Host "ERROR: unknown profile '$ProfileName' (expected testing/profiles/$ProfileName.json)" -ForegroundColor Red
    exit 2
}

$RunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutputDir = Join-Path $env:TEMP "nexus-sandbox-$RunStamp"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$ResultPath = Join-Path $OutputDir "result.json"

$Wsb = Join-Path $OutputDir "nexus-smoke.wsb"
(Get-Content $Template -Raw).
    Replace("{{DIST_DIR}}", $DistDir).
    Replace("{{TESTING_DIR}}", $TestingDir).
    Replace("{{OUTPUT_DIR}}", $OutputDir).
    Replace("{{PROFILE}}", $ProfileName) |
    Out-File $Wsb -Encoding utf8

Write-Host "[sandbox-test] profile:  $ProfileName"
Write-Host "[sandbox-test] output:   $OutputDir"
Write-Host "[sandbox-test] starting Windows Sandbox (fresh machine)..."
Start-Process -FilePath $Sandbox -ArgumentList "`"$Wsb`"" | Out-Null

$Deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 10
    if (Test-Path $ResultPath) { break }
}

if (-not (Test-Path $ResultPath)) {
    Write-Host "[sandbox-test] TIMEOUT: no result.json after ${TimeoutSec}s (see the sandbox window / $OutputDir\console.log)" -ForegroundColor Red
    exit 3
}

$Result = Get-Content $ResultPath -Raw | ConvertFrom-Json
Write-Host ""
Write-Host "=== sandbox smoke result (schema $($Result.schema)) ==="
Write-Host ("profile:       " + $Result.profile)
Write-Host ("success:       " + $Result.success)
Write-Host ("steps done:    " + ($Result.steps_done -join ", "))
Write-Host ("steps failed:  " + ($Result.steps_failed -join ", "))
if ($Result.failed_models) {
    Write-Host ("failed models: " + ($Result.failed_models -join ", "))
}
Write-Host ("full logs:     $OutputDir")
Write-Host ""
Write-Host "NOTE: the sandbox window is left open for inspection; close it manually." -ForegroundColor Yellow

if ($Result.success) {
    Write-Host "[sandbox-test] PASS" -ForegroundColor Green
    exit 0
}
Write-Host "[sandbox-test] FAIL" -ForegroundColor Red
exit 1
