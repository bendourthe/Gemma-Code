#Requires -Version 5.1
<#
.SYNOPSIS
    Build pipeline for the Gemma Code VS Code extension VSIX package.

.DESCRIPTION
    Runs lint, tests, TypeScript compilation, asset bundling, and VSIX packaging
    in sequence. Exits with a non-zero code on any failure.

.PARAMETER SkipTests
    Skip the test and lint steps (use only for local dev iteration).

.PARAMETER OutputDir
    Directory where the final .vsix file is written. Defaults to the repo root.
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [string]$OutputDir = $PSScriptRoot\..
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ─────────────────────────────────────────────────────────────────

function Log-Step {
    param([string]$Message)
    Write-Host "[BUILD] $Message" -ForegroundColor Cyan
}

function Log-Success {
    param([string]$Message)
    Write-Host "[OK]    $Message" -ForegroundColor Green
}

function Log-Error {
    param([string]$Message)
    Write-Host "[FAIL]  $Message" -ForegroundColor Red
}

function Invoke-Step {
    param([string]$Label, [scriptblock]$Action)
    Log-Step $Label
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Log-Error "$Label failed (exit $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
    Log-Success $Label
}

# ── Resolve paths ────────────────────────────────────────────────────────────

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$SrcBackend = Join-Path $RepoRoot 'src\backend'
$SrcSkills  = Join-Path $RepoRoot 'src\skills\catalog'
$OutDir     = Join-Path $RepoRoot 'out'
$OutWebview = Join-Path $OutDir 'webview'
$OutBackend = Join-Path $OutDir 'backend'
$OutSkills  = Join-Path $OutDir 'skills'

Push-Location $RepoRoot

try {

    # ── Step 1: Install dependencies ─────────────────────────────────────────

    Invoke-Step 'npm ci (install dependencies)' {
        npm ci --prefer-offline --no-audit --silent
    }

    # ── Step 2: Lint ─────────────────────────────────────────────────────────

    if (-not $SkipTests) {
        Invoke-Step 'ESLint (lint TypeScript source)' {
            npm run lint --silent
        }
    }

    # ── Step 3: Unit tests ───────────────────────────────────────────────────

    if (-not $SkipTests) {
        Invoke-Step 'Vitest (unit tests)' {
            npm run test --silent
        }
    }

    # ── Step 4: TypeScript compilation ───────────────────────────────────────

    Invoke-Step 'tsc (compile TypeScript)' {
        npm run build --silent
    }

    # ── Step 5: Bundle webview assets ────────────────────────────────────────

    Invoke-Step 'Bundle webview assets into out/webview/' {
        $null = New-Item -ItemType Directory -Force -Path $OutWebview
        $WebviewSrc = Join-Path $RepoRoot 'src\panels\webview'
        if (Test-Path $WebviewSrc) {
            Copy-Item "$WebviewSrc\*" -Destination $OutWebview -Recurse -Force
        }
        # Copy highlight.js from node_modules for syntax highlighting
        $HljsMin = Join-Path $RepoRoot 'node_modules\highlight.js\build\highlight.min.js'
        if (Test-Path $HljsMin) {
            Copy-Item $HljsMin -Destination $OutWebview -Force
        }
        0  # explicit success
    }

    # ── Step 6: Bundle Python backend ────────────────────────────────────────

    Invoke-Step 'Bundle Python backend into out/backend/' {
        $null = New-Item -ItemType Directory -Force -Path $OutBackend
        if (Test-Path $SrcBackend) {
            Copy-Item "$SrcBackend\src" -Destination $OutBackend -Recurse -Force
            Copy-Item (Join-Path $SrcBackend 'pyproject.toml') -Destination $OutBackend -Force
        }
        0
    }

    # ── Step 7: Copy skills catalog ──────────────────────────────────────────

    Invoke-Step 'Copy built-in skills catalog into out/skills/' {
        $null = New-Item -ItemType Directory -Force -Path $OutSkills
        if (Test-Path $SrcSkills) {
            Copy-Item "$SrcSkills\*" -Destination $OutSkills -Recurse -Force
        }
        0
    }

    # ── Step 8: Package VSIX ─────────────────────────────────────────────────

    Invoke-Step 'vsce package (create VSIX)' {
        $Version = (Get-Content (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json).version
        $VsixName = "gemma-code-$Version.vsix"
        $VsixOut  = Join-Path $OutputDir $VsixName
        npx vsce package --no-dependencies --out $VsixOut
        if ($LASTEXITCODE -eq 0) {
            Log-Success "VSIX written to: $VsixOut"
        }
    }

} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Build complete.' -ForegroundColor Green
