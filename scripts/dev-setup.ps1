#Requires -Version 5.1
<#
.SYNOPSIS
    Dev setup for the Gemma Code VS Code extension on Windows.
.DESCRIPTION
    Verifies prerequisites (Node.js 18+, npm, optional Ollama), installs
    dependencies, runs the prebuild generator, and compiles TypeScript.
    Idempotent: re-running is safe.
#>

$ErrorActionPreference = "Stop"

function Write-Log { param([string]$Msg) Write-Host "[dev-setup] $Msg" }
function Write-Err { param([string]$Msg) Write-Host "[dev-setup] ERROR: $Msg" -ForegroundColor Red }

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

# ---------------------------------------------------------------------------
# Node + npm
# ---------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Err "node not found. Install Node.js 18+ from https://nodejs.org/"
    exit 1
}

$nodeVersion = (node --version) -replace "^v", ""
$nodeMajor   = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 18) {
    Write-Err "node $nodeVersion detected; 18+ required."
    exit 1
}
Write-Log "node v$nodeVersion OK"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($null -eq $npm) {
    Write-Err "npm not found. It usually ships with Node.js."
    exit 1
}
Write-Log "npm $(npm --version) OK"

# ---------------------------------------------------------------------------
# Ollama (warn-only; build can proceed without a runtime backend)
# ---------------------------------------------------------------------------
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($null -ne $ollama) {
    Write-Log "ollama present OK"
} else {
    Write-Log "ollama not found. The extension needs it at runtime."
    Write-Log "  Install: https://ollama.com/download"
    Write-Log "  After install, run: ollama pull gemma4"
}

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
Write-Log "Installing npm dependencies..."
npm install --no-fund --no-audit --silent
if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed."; exit 1 }

# ---------------------------------------------------------------------------
# Generate + build
# ---------------------------------------------------------------------------
Write-Log "Running prebuild..."
npm run generate:golden-tasks --silent
if ($LASTEXITCODE -ne 0) { Write-Err "Generate step failed."; exit 1 }

Write-Log "Compiling TypeScript..."
npm run build --silent
if ($LASTEXITCODE -ne 0) { Write-Err "Build failed."; exit 1 }

Write-Log "Setup complete. Next steps:"
Write-Log "  npm run dev     # tsc --watch"
Write-Log "  npm test        # run unit + integration tests"
Write-Log "  F5 in VS Code   # launch Extension Development Host"
