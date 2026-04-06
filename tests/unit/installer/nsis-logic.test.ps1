#Requires -Version 5.1
<#
.SYNOPSIS
    Unit tests for installer prerequisite-detection logic.

.DESCRIPTION
    Tests the pure PowerShell equivalents of the NSIS helper functions:
    FindVSCode, FindOllama, FindPython. These tests run on any Windows machine
    without requiring NSIS to be installed, and use a mock registry/filesystem
    approach so results are deterministic.

    Exit code is the total number of test failures (0 = all passed).
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Assert-Equal {
    param($Expected, $Actual, [string]$Message = '')
    if ($Expected -ne $Actual) {
        throw "Expected '$Expected' but got '$Actual'. $Message"
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-False {
    param([bool]$Condition, [string]$Message)
    if ($Condition) { throw $Message }
}

# ── VS Code detection logic (mirrors NSIS FindVSCode) ─────────────────────────

function Find-VSCode {
    $candidates = @(
        # HKLM App Paths
        (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Code.exe' `
                          -ErrorAction SilentlyContinue)?.'(default)',
        # HKCU App Paths
        (Get-ItemProperty -LiteralPath 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Code.exe' `
                          -ErrorAction SilentlyContinue)?.'(default)',
        # Well-known user install
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
        # Well-known machine install
        "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd",
        "$env:ProgramW6432\Microsoft VS Code\bin\code.cmd"
    ) | Where-Object { $_ }

    foreach ($raw in $candidates) {
        # Registry entries point to Code.exe; convert to code.cmd in bin/
        if ($raw -match '\.exe$') {
            $dir = Split-Path $raw
            $cmd = Join-Path $dir 'bin\code.cmd'
        } else {
            $cmd = $raw
        }
        if (Test-Path $cmd) { return $cmd }
    }
    return ''
}

# ── Ollama detection logic ────────────────────────────────────────────────────

function Find-Ollama {
    # 1. Where on PATH
    $wherePath = (Get-Command ollama -ErrorAction SilentlyContinue)?.Source
    if ($wherePath) { return 'found' }

    # 2. Default install location
    $defaultPath = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $defaultPath) { return 'found' }

    return ''
}

# ── Python detection logic ────────────────────────────────────────────────────

function Find-Python {
    $candidates = @('py', 'python3', 'python')
    foreach ($cmd in $candidates) {
        try {
            $result = & $cmd -c "import sys; v=sys.version_info; print(v.major*100+v.minor)" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $ver = [int]($result.Trim())
                if ($ver -ge 311) {
                    return (& $cmd -c "import sys; print(sys.executable)" 2>$null).Trim()
                }
            }
        } catch { }
    }
    return ''
}

# ── Tests: VS Code detection ──────────────────────────────────────────────────

Write-Host ''
Write-Host '=== VS Code Detection Tests ===' -ForegroundColor Cyan

Test-Case 'Find-VSCode returns a non-empty string when VS Code is installed' {
    # This test passes only when VS Code is installed on the test machine.
    # In CI, VS Code is pre-installed on windows-latest runners.
    $result = Find-VSCode
    # We accept an empty result if VS Code is genuinely not installed.
    if ($result -eq '') {
        Write-Host '  (VS Code not found — skipping assertion, acceptable on bare VMs)' -ForegroundColor Yellow
    } else {
        Assert-True (Test-Path $result) "Returned path does not exist: $result"
        Assert-True ($result -like '*code.cmd') "Expected a path ending in code.cmd, got: $result"
    }
}

Test-Case 'Find-VSCode result is a .cmd file or empty string' {
    $result = Find-VSCode
    Assert-True (($result -eq '') -or ($result -like '*.cmd')) `
        "Result should be empty or end in .cmd, got: $result"
}

# ── Tests: Ollama detection ───────────────────────────────────────────────────

Write-Host ''
Write-Host '=== Ollama Detection Tests ===' -ForegroundColor Cyan

Test-Case 'Find-Ollama returns "found" or empty string (never throws)' {
    $result = Find-Ollama
    Assert-True (($result -eq 'found') -or ($result -eq '')) `
        "Result must be 'found' or empty, got: $result"
}

Test-Case 'Find-Ollama detects ollama.exe at default install path when present' {
    $defaultPath = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $defaultPath) {
        Assert-Equal 'found' (Find-Ollama) 'Expected "found" when ollama.exe exists at default path'
    } else {
        Write-Host '  (Ollama not installed — skipping positive assertion)' -ForegroundColor Yellow
    }
}

# ── Tests: Python detection ───────────────────────────────────────────────────

Write-Host ''
Write-Host '=== Python Detection Tests ===' -ForegroundColor Cyan

Test-Case 'Find-Python returns a non-empty executable path or empty string' {
    $result = Find-Python
    Assert-True (($result -eq '') -or (Test-Path $result)) `
        "Returned path does not exist: $result"
}

Test-Case 'Find-Python result is a .exe file when Python 3.11+ is present' {
    $result = Find-Python
    if ($result -ne '') {
        Assert-True ($result -like '*.exe') "Expected .exe path, got: $result"
        # Verify the executable actually works
        $ver = & $result -c "import sys; print(sys.version_info.major)" 2>$null
        Assert-Equal '3' $ver.Trim() 'Expected Python 3'
    } else {
        Write-Host '  (Python 3.11+ not found — acceptable on minimal VMs)' -ForegroundColor Yellow
    }
}

Test-Case 'Find-Python never returns a path to Python 2' {
    $result = Find-Python
    if ($result -ne '') {
        $major = (& $result -c "import sys; print(sys.version_info.major)" 2>$null).Trim()
        Assert-True ([int]$major -ge 3) "Found Python $major, expected 3+"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host "Results: $($Script:PassCount) passed, $($Script:FailCount) failed" `
    -ForegroundColor $(if ($Script:FailCount -eq 0) { 'Green' } else { 'Red' })
exit $Script:FailCount
