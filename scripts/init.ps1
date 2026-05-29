#Requires -Version 5.1
<#
.SYNOPSIS
    v0.8.0 Phase 2 (item C2) -- lifecycle bootstrap for Gemma Code on Windows.
.DESCRIPTION
    Five verified steps before any work begins:
      1. npm ci
      2. npm run lint
      3. npm run build
      4. Required harness files present at repo root
      5. Required specialist asset files present
    Exit 0 only when all five steps pass. Exit 1 with a descriptive error
    otherwise. Idempotent -- safe to re-run.
    See scripts/init.sh for the POSIX equivalent.
#>

$ErrorActionPreference = "Stop"

function Write-LogInfo  { param([string]$Msg) Write-Host "[init] $Msg" }
function Write-LogStep  { param([string]$Msg) Write-Host "[init] ---- $Msg ----" }
function Write-LogError { param([string]$Msg) Write-Host "[init] ERROR: $Msg" -ForegroundColor Red }

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$RequiredFiles = @(
    "AGENTS.md",
    "ARCHITECTURE.md",
    "feature_list.json",
    "clean-state-checklist.md",
    "docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md",
    "docs/archive/versions/v0/v0.8.0/known-gaps.md"
)

$RequiredSpecialists = @(
    "assets/specialists/research.md",
    "assets/specialists/verification.md",
    "assets/specialists/planning.md",
    "assets/specialists/orchestration.md"
)

# ---------------------------------------------------------------------------
# Step 1: npm ci
# ---------------------------------------------------------------------------
Write-LogStep "Step 1/5: npm ci"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-LogError "npm not found on PATH. Install Node.js 20+ from https://nodejs.org/"
    exit 1
}
npm ci --silent | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-LogError "Step 1 (npm ci) failed. Check your network and node version."
    exit 1
}
Write-LogInfo "Step 1 OK"

# ---------------------------------------------------------------------------
# Step 2: npm run lint
# ---------------------------------------------------------------------------
Write-LogStep "Step 2/5: npm run lint"
npm run --silent lint
if ($LASTEXITCODE -ne 0) {
    Write-LogError "Step 2 (lint) failed. Fix lint errors before continuing."
    exit 1
}
Write-LogInfo "Step 2 OK"

# ---------------------------------------------------------------------------
# Step 3: npm run build
# ---------------------------------------------------------------------------
Write-LogStep "Step 3/5: npm run build"
npm run --silent build
if ($LASTEXITCODE -ne 0) {
    Write-LogError "Step 3 (build) failed. Fix type errors before continuing."
    exit 1
}
Write-LogInfo "Step 3 OK"

# ---------------------------------------------------------------------------
# Step 4: harness files present
# ---------------------------------------------------------------------------
Write-LogStep "Step 4/5: harness files"
$Missing = @()
foreach ($f in $RequiredFiles) {
    $abs = Join-Path $RepoRoot $f
    if (-not (Test-Path -LiteralPath $abs -PathType Leaf)) {
        $Missing += $f
    }
}
if ($Missing.Count -gt 0) {
    Write-LogError "Step 4 failed -- missing harness files:"
    foreach ($f in $Missing) { Write-LogError "  - $f" }
    exit 1
}
Write-LogInfo "Step 4 OK"

# ---------------------------------------------------------------------------
# Step 5: specialist asset files present
# ---------------------------------------------------------------------------
Write-LogStep "Step 5/5: specialist assets"
$Missing = @()
foreach ($f in $RequiredSpecialists) {
    $abs = Join-Path $RepoRoot $f
    if (-not (Test-Path -LiteralPath $abs -PathType Leaf)) {
        $Missing += $f
    }
}
if ($Missing.Count -gt 0) {
    Write-LogError "Step 5 failed -- missing specialist asset files:"
    foreach ($f in $Missing) { Write-LogError "  - $f" }
    exit 1
}
Write-LogInfo "Step 5 OK"

Write-Host "[init] All five steps passed. Ready to work."
