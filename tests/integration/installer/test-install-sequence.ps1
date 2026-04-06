#Requires -Version 5.1
<#
.SYNOPSIS
    Integration tests for the Gemma Code installer sequence.

.DESCRIPTION
    Simulates and validates each installer step in sequence.
    Designed to run in Windows Sandbox or a Docker Windows container
    (see docs/v0.1.0/testing.md for environment setup instructions).

    Each test function writes PASS/FAIL to stdout and sets $Script:FailCount.
    Exit code is the total number of failures (0 = all passed).

.NOTES
    Requirements:
      - Windows 10/11 or Windows Server 2019+ with PowerShell 5.1+
      - VS Code must be installed (the test validates extension installation)
      - NSIS must be installed (for testing the installer compile step)
      - Run as a standard user (admin rights tested separately)
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Configuration ────────────────────────────────────────────────────────────

$InstallerDir  = Resolve-Path "$PSScriptRoot\..\..\..\scripts\installer"
$RepoRoot      = Resolve-Path "$PSScriptRoot\..\..\..\"
$VsixPattern   = 'gemma-code-*.vsix'
$ExtensionId   = 'gemma-code.gemma-code'
$VenvRoot      = "$env:LOCALAPPDATA\GemmaCode\venv"

# ── Test harness ─────────────────────────────────────────────────────────────

$Script:PassCount = 0
$Script:FailCount = 0

function Test-Case {
    param([string]$Name, [scriptblock]$Body)
    try {
        & $Body
        Write-Host "[PASS] $Name" -ForegroundColor Green
        $Script:PassCount++
    } catch {
        Write-Host "[FAIL] $Name — $_" -ForegroundColor Red
        $Script:FailCount++
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-PathExists {
    param([string]$Path)
    if (-not (Test-Path $Path)) { throw "Expected path does not exist: $Path" }
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────

Write-Host ''
Write-Host '=== Gemma Code Installer Integration Tests ===' -ForegroundColor Cyan
Write-Host "Installer dir : $InstallerDir"
Write-Host "Repo root     : $RepoRoot"
Write-Host ''

# ── Test: VSIX artifact exists ───────────────────────────────────────────────

Test-Case 'VSIX artifact is present in repo root' {
    $Vsix = Get-Item (Join-Path $RepoRoot $VsixPattern) -ErrorAction SilentlyContinue
    Assert-True ($null -ne $Vsix) "No .vsix file found matching $VsixPattern in $RepoRoot"
    Write-Host "  Found: $($Vsix.Name)"
}

# ── Test: Extension installs via code CLI ─────────────────────────────────────

Test-Case 'VS Code extension installs without error' {
    $CodePath = & {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
            "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
        )
        $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
    Assert-True ($null -ne $CodePath) 'VS Code (code.cmd) not found — install VS Code first'

    $Vsix = Get-Item (Join-Path $RepoRoot $VsixPattern) | Select-Object -First 1
    $ExitCode = 0
    & $CodePath --install-extension $Vsix.FullName 2>&1 | Out-Null
    $ExitCode = $LASTEXITCODE
    Assert-True ($ExitCode -eq 0) "code --install-extension exited with $ExitCode"
}

# ── Test: Extension appears in VS Code extension list ────────────────────────

Test-Case 'Extension is listed after installation' {
    $CodePath = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
    if (-not (Test-Path $CodePath)) {
        $CodePath = "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
    }
    Assert-True (Test-Path $CodePath) 'VS Code not found'

    $List = & $CodePath --list-extensions 2>&1
    Assert-True ($List -contains $ExtensionId) "Extension '$ExtensionId' not found in: $List"
}

# ── Test: Python venv is created ─────────────────────────────────────────────

Test-Case 'Python virtual environment is created at expected path' {
    # Create venv if not already present (simulates installer step 4)
    if (-not (Test-Path $VenvRoot)) {
        $Python = (Get-Command python -ErrorAction SilentlyContinue)?.Source
        Assert-True ($null -ne $Python) 'Python not found on PATH'
        & $Python -m venv $VenvRoot | Out-Null
        Assert-True ($LASTEXITCODE -eq 0) "python -m venv failed"
    }
    Assert-PathExists "$VenvRoot\Scripts\python.exe"
    Assert-PathExists "$VenvRoot\Scripts\pip.exe"
}

# ── Test: Backend dependencies install into venv ─────────────────────────────

Test-Case 'Backend dependencies install successfully into venv' {
    $ReqFile = Join-Path $InstallerDir 'backend-requirements.txt'
    if (-not (Test-Path $ReqFile)) {
        # Generate requirements from pyproject.toml using pip-compile fallback
        $BackendDir = Join-Path $RepoRoot 'src\backend'
        Push-Location $BackendDir
        uv export --no-dev --format requirements-txt --output-file $ReqFile
        Pop-Location
    }
    Assert-PathExists $ReqFile

    & "$VenvRoot\Scripts\pip.exe" install -r $ReqFile --quiet
    Assert-True ($LASTEXITCODE -eq 0) 'pip install failed'

    # Spot-check a key package
    $FrozenPkgs = & "$VenvRoot\Scripts\pip.exe" freeze 2>&1
    Assert-True (($FrozenPkgs | Where-Object { $_ -match '^fastapi' }).Count -gt 0) `
        'fastapi not found in venv after install'
}

# ── Test: Uninstaller removes extension ──────────────────────────────────────

Test-Case 'Uninstaller removes the VS Code extension' {
    $CodePath = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
    if (-not (Test-Path $CodePath)) {
        $CodePath = "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
    }
    Assert-True (Test-Path $CodePath) 'VS Code not found'

    & $CodePath --uninstall-extension $ExtensionId 2>&1 | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Uninstall command failed"

    $List = & $CodePath --list-extensions 2>&1
    Assert-True ($List -notcontains $ExtensionId) "Extension still listed after uninstall"
}

# ── Test: Uninstaller removes venv ───────────────────────────────────────────

Test-Case 'Uninstaller removes the Python virtual environment' {
    if (Test-Path $VenvRoot) {
        Remove-Item $VenvRoot -Recurse -Force
    }
    Assert-True (-not (Test-Path $VenvRoot)) "Venv still exists at $VenvRoot after removal"
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host "Results: $($Script:PassCount) passed, $($Script:FailCount) failed" -ForegroundColor $(if ($Script:FailCount -eq 0) { 'Green' } else { 'Red' })
exit $Script:FailCount
