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

.PARAMETER ElectronVersion
    Electron version that `better-sqlite3` is rebuilt against (v1.15.0 Phase 7).
    MUST match the Electron shipped by the target VS Code build, or the packaged
    native module fails to load at runtime with a NODE_MODULE_VERSION mismatch,
    which aborts extension activation. Defaults to $DefaultElectronVersion below;
    override when packaging for a different VS Code baseline, or set the
    NEXUS_ELECTRON_VERSION environment variable.
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [string]$OutputDir,
    [string]$ElectronVersion
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
if (-not $OutputDir) { $OutputDir = $RepoRoot } else { $OutputDir = (Resolve-Path $OutputDir).Path }
$SrcBackend = Join-Path $RepoRoot 'src\backend'
$SrcSkills  = Join-Path $RepoRoot 'src\skills\catalog'
$OutDir     = Join-Path $RepoRoot 'out'
$OutWebview = Join-Path $OutDir 'webview'
$OutBackend = Join-Path $OutDir 'backend'
$OutSkills  = Join-Path $OutDir 'skills'

# v1.15.0 Phase 7 (Issue 6): the Electron ABI that better-sqlite3 is rebuilt for.
# Precedence: -ElectronVersion parameter > NEXUS_ELECTRON_VERSION env var >
# the default baseline. Keep the default in step with the Electron shipped by
# the minimum supported VS Code (see engines.vscode in package.json); a mismatch
# ships a native module that cannot load, which kills extension activation.
$DefaultElectronVersion = '36.4.0'
$ResolvedElectronVersion = $DefaultElectronVersion
if ($env:NEXUS_ELECTRON_VERSION) { $ResolvedElectronVersion = $env:NEXUS_ELECTRON_VERSION }
if ($ElectronVersion) { $ResolvedElectronVersion = $ElectronVersion }

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

    # ── Step 4b: Rebuild native modules for VS Code Electron ─────────────────

    Invoke-Step "Rebuild better-sqlite3 for VS Code Electron $ResolvedElectronVersion" {
        # @electron/rebuild streams progress to stderr; under Windows PowerShell
        # 5.1 with ErrorActionPreference=Stop the first stderr line is promoted to
        # a terminating NativeCommandError and aborts the build before it can
        # finish. Drop to Continue inside this step so only a non-zero exit code
        # (checked by Invoke-Step via $LASTEXITCODE) fails it.
        #
        # v1.15.0 Phase 7 (Issue 6): the version is no longer hardcoded. Shipping
        # a module built for the wrong Electron ABI is what makes the extension
        # fail to activate ("command not found" + forever-loading views).
        $ErrorActionPreference = 'Continue'
        npx @electron/rebuild --version $ResolvedElectronVersion --only better-sqlite3 --force
    }

    # ── Step 5: Bundle webview assets ────────────────────────────────────────

    Invoke-Step 'Bundle webview assets into out/webview/' {
        $null = New-Item -ItemType Directory -Force -Path $OutWebview
        $WebviewSrc = Join-Path $RepoRoot 'src\panels\webview'
        if (Test-Path $WebviewSrc) {
            Copy-Item "$WebviewSrc\*" -Destination $OutWebview -Recurse -Force
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
        # vsce also streams progress/warnings to stderr; same PS 5.1 guard as the
        # electron-rebuild step above (Invoke-Step still gates on $LASTEXITCODE).
        $ErrorActionPreference = 'Continue'
        $Version = (Get-Content (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json).version
        # v1.11.0 Phase 4 (T403): the artifact carries the product name
        # (nexus-coding), closing the NAME.P1.A remnant for this artifact.
        $VsixName = "nexus-coding-$Version.vsix"
        $VsixOut  = Join-Path $OutputDir $VsixName
        npx vsce package --out $VsixOut
        if ($LASTEXITCODE -eq 0) {
            Log-Success "VSIX written to: $VsixOut"
        }
    }

} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Build complete.' -ForegroundColor Green
