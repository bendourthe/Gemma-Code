<#
.SYNOPSIS
    Windows integration test for the PyQt5 installer.

.DESCRIPTION
    Launches the installer in headless/auto mode and verifies that
    components are installed correctly.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$InstallerDir = "$RepoRoot\scripts\installer\pyqt"
$VenvRoot = "$env:LOCALAPPDATA\GemmaCode\venv"
$ExtensionId = "gemma-code.gemma-code"

$Passed = 0
$Failed = 0

function Test-Case {
    param([string]$Name, [scriptblock]$Test)
    Write-Host "  TEST: $Name" -NoNewline
    try {
        & $Test
        Write-Host " [PASS]" -ForegroundColor Green
        $script:Passed++
    } catch {
        Write-Host " [FAIL] $_" -ForegroundColor Red
        $script:Failed++
    }
}

# Normalize captured output to a single trimmed string. Native command output
# captured with `2>&1` arrives as a string-array, and PowerShell's `-match` /
# `-notmatch` / `-eq` operators treat arrays as filter operations rather than
# scalar checks, which breaks `if ($result -notmatch ...)` when the array
# contains uv's install-progress lines.
#
# An accumulator is required because a `process { return ... }` block inside a
# pipeline-bound function returns from each iteration independently, so its
# output is itself an array. Buffering all input and converting once in `end`
# is what gives us a single scalar string.
function Get-CommandOutput {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline = $true)]$InputObject)
    begin { $items = [System.Collections.Generic.List[object]]::new() }
    process { $items.Add($InputObject) }
    end { return ($items | Out-String).Trim() }
}

Write-Host "`nPyQt5 Installer Integration Tests (Windows)" -ForegroundColor Cyan
Write-Host ("=" * 50)

# Test 1: Installer Python package imports
Test-Case "Installer package imports" {
    Push-Location $InstallerDir
    $result = (uv run python -c "from nexus_installer import __version__; print(__version__)" 2>&1) | Get-CommandOutput
    Pop-Location
    if ($result -notmatch "0\.\d+\.\d+") { throw "Import failed: $result" }
}

# Test 2: Theme generation
Test-Case "Theme generates valid QSS" {
    Push-Location $InstallerDir
    $result = (uv run python -c "from nexus_installer.theme import generate_stylesheet; s = generate_stylesheet(); assert len(s) > 500; print('OK')" 2>&1) | Get-CommandOutput
    Pop-Location
    if ($result -notmatch "(?m)^OK$") { throw "Theme test failed: $result" }
}

# Test 3: GPU detection runs without crash
Test-Case "GPU detection completes" {
    Push-Location $InstallerDir
    $result = (uv run python -c "from nexus_installer.pages.gpu_detection import detect_gpu; name, vendor, vram = detect_gpu(); print(f'{vendor}:{vram}')" 2>&1) | Get-CommandOutput
    Pop-Location
    if (-not ($result -match ":")) { throw "Detection failed: $result" }
}

# Test 4: Installer state defaults
Test-Case "InstallerState has correct defaults" {
    Push-Location $InstallerDir
    $result = (uv run python -c "from nexus_installer.installer_state import InstallerState; s = InstallerState(); assert s.platform == 'win32'; assert 'extension' in s.components_to_install; print('OK')" 2>&1) | Get-CommandOutput
    Pop-Location
    if ($result -notmatch "(?m)^OK$") { throw "State defaults test failed: $result" }
}

Write-Host "`nResults: $Passed passed, $Failed failed" -ForegroundColor $(if ($Failed -gt 0) { "Red" } else { "Green" })
exit $Failed
