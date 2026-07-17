<#
.SYNOPSIS
    v1.11.0 Phase 7 (T705) background-continuation scenario driver.

.DESCRIPTION
    Background continuation (tray detach + reattach) is an inherently GUI flow,
    so this scenario is operator-driven for the clicks but programmatically
    verifies the part a script CAN check: the persisted state file
    (state.json) written continuously by the engine's signal surface (T701).

    It points the installer at a known, isolated state directory (via the
    NEXUS_INSTALLER_STATE_DIR override), launches NexusSetup.exe, prints the
    operator steps, then polls state.json and reports each status/step/model
    transition until the run reaches a terminal status (completed / failed /
    cancelled) or the timeout elapses. Run it inside Windows Sandbox for a true
    clean-machine check, or on the dev host for a quick local pass.

.PARAMETER Scenario
    Which scenario to narrate:
      close-to-tray  : close the window mid-download, choose "Continue in
                       background", confirm the tray shows live progress, then
                       reopen from the tray and let it finish (T702/T703).
      reattach       : while installing, launch NexusSetup.exe a second time and
                       confirm it surfaces the SAME window (no duplicate) (T703).
      crash-resume   : kill NexusSetup.exe mid-download, relaunch, and confirm
                       the resume-or-restart prompt appears; choose Resume and
                       confirm already-done steps are skipped (T704).

.PARAMETER TimeoutSec
    How long to poll state.json before giving up.

.NOTES
    Build dist/NexusSetup.exe first:
      pwsh scripts/installer/build/build-windows.ps1 -SkipSign
    The state file lives under the directory printed at startup; inspect it by
    hand at any time -- it is plain JSON.
#>
[CmdletBinding()]
param(
    [ValidateSet("close-to-tray", "reattach", "crash-resume")]
    [string]$Scenario = "close-to-tray",
    [int]$TimeoutSec = 1800
)

$ErrorActionPreference = 'Stop'
$TestingDir = Split-Path -Parent $PSScriptRoot
$RepoRoot = (Resolve-Path "$TestingDir\..\..\..").Path
$Exe = Join-Path $RepoRoot "dist\NexusSetup.exe"

if (-not (Test-Path $Exe)) {
    Write-Host "ERROR: $Exe not found. Build it first: pwsh scripts/installer/build/build-windows.ps1 -SkipSign" -ForegroundColor Red
    exit 2
}

$RunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$StateDir = Join-Path $env:TEMP "nexus-bg-$RunStamp"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$StateFile = Join-Path $StateDir "state.json"
$env:NEXUS_INSTALLER_STATE_DIR = $StateDir

Write-Host "[bg-scenario] scenario:   $Scenario"
Write-Host "[bg-scenario] state dir:  $StateDir"
Write-Host "[bg-scenario] state file: $StateFile"
Write-Host ""

switch ($Scenario) {
    "close-to-tray" {
        Write-Host "OPERATOR STEPS (T702/T703):" -ForegroundColor Cyan
        Write-Host "  1. Run the wizard through to the Installing step."
        Write-Host "  2. While models are downloading, close the window."
        Write-Host "  3. Choose 'Continue in background'."
        Write-Host "  4. Confirm a tray icon appears with a live percent tooltip."
        Write-Host "  5. Right-click the tray icon -> 'Open installer' to reattach."
        Write-Host "  6. Let the install finish; confirm the completion notification."
    }
    "reattach" {
        Write-Host "OPERATOR STEPS (T703):" -ForegroundColor Cyan
        Write-Host "  1. Run the wizard to the Installing step (leave it running)."
        Write-Host "  2. Launch NexusSetup.exe a SECOND time."
        Write-Host "  3. Confirm NO second window opens -- the first surfaces instead."
    }
    "crash-resume" {
        Write-Host "OPERATOR STEPS (T704):" -ForegroundColor Cyan
        Write-Host "  1. Run the wizard to the Installing step."
        Write-Host "  2. While a model downloads, HARD-KILL the process:"
        Write-Host "       Stop-Process -Name NexusSetup -Force"
        Write-Host "  3. Relaunch NexusSetup.exe."
        Write-Host "  4. Confirm the 'Resume installation?' prompt appears; choose Resume."
        Write-Host "  5. Confirm already-installed steps are skipped in the log."
    }
}

Write-Host ""
Write-Host "[bg-scenario] launching NexusSetup.exe (state dir override active)..."
Start-Process -FilePath $Exe | Out-Null

Write-Host "[bg-scenario] polling $StateFile for transitions (Ctrl+C to stop)..."
$Deadline = (Get-Date).AddSeconds($TimeoutSec)
$LastStatus = ""
$LastSummary = ""
$SawRunning = $false

while ((Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 3
    if (-not (Test-Path $StateFile)) { continue }
    try {
        $State = Get-Content $StateFile -Raw | ConvertFrom-Json
    }
    catch { continue }

    if ($State.status -eq "running") { $SawRunning = $true }

    $doneSteps = @($State.steps.PSObject.Properties | Where-Object { $_.Value -eq "done" } | ForEach-Object { $_.Name })
    $summary = "status=$($State.status) progress=$([math]::Round($State.overall_progress * 100))% done=[$($doneSteps -join ',')]"
    if ($summary -ne $LastSummary) {
        Write-Host ("[bg-scenario] " + $summary)
        $LastSummary = $summary
    }
    $LastStatus = $State.status

    if ($State.status -in @("completed", "failed", "cancelled")) { break }
}

Write-Host ""
if (-not (Test-Path $StateFile)) {
    Write-Host "[bg-scenario] NO state file was written -- T701 persistence FAILED." -ForegroundColor Red
    exit 1
}

$Final = Get-Content $StateFile -Raw | ConvertFrom-Json
Write-Host "=== final state ($StateFile) ==="
Write-Host ("status:           " + $Final.status)
Write-Host ("overall progress: " + [math]::Round($Final.overall_progress * 100) + "%")
Write-Host ("saw 'running':    " + $SawRunning)
Write-Host ("failed steps:     " + ($Final.failed_steps -join ", "))
Write-Host ("failed models:    " + ($Final.failed_models -join ", "))
Write-Host ""

# The scriptable assertion: the engine persisted a live, then terminal, state.
if ($SawRunning -and ($Final.status -in @("completed", "failed", "cancelled"))) {
    Write-Host "[bg-scenario] PASS: state persisted through 'running' -> '$($Final.status)'." -ForegroundColor Green
    Write-Host "NOTE: the tray/reattach visuals are an operator confirmation (see steps above)." -ForegroundColor Yellow
    exit 0
}
Write-Host "[bg-scenario] INCONCLUSIVE (last status: $LastStatus). Confirm the operator steps completed." -ForegroundColor Yellow
exit 1
