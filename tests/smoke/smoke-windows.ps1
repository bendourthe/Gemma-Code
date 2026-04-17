#Requires -Version 5.1
<#
.SYNOPSIS
    Windows smoke test: install Ollama (if missing), run the installer in
    headless mode, verify components, then clean up.
.NOTES
    Assumes VS Code and Python 3.11+ are already installed.
#>
[CmdletBinding()]
param(
    [string]$InstallPath = (Join-Path $env:TEMP "gemma-smoke"),
    [string]$Model = "gemma4:e2b",
    [switch]$WithModel
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$resultsDir = Join-Path $PSScriptRoot "results"
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

function Write-Header {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Test-Command {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Header "Checking prerequisites"
if (-not (Test-Command code)) { throw "VS Code (code CLI) not on PATH" }
if (-not (Test-Command python)) { throw "Python 3.11+ not on PATH" }

Write-Header "Ensuring Ollama is installed"
if (-not (Test-Command ollama)) {
    Write-Host "  installing Ollama via winget..."
    winget install --exact --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements | Out-Null
}

Write-Header "Starting Ollama service (background)"
$ollamaProc = Start-Process -FilePath "ollama" -ArgumentList "serve" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

# Poll /api/tags for up to 60 seconds
$deadline = (Get-Date).AddSeconds(60)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 | Out-Null
        $ready = $true; break
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw "Ollama failed to respond within 60 seconds" }

Write-Header "Running installer in headless mode"
Push-Location (Join-Path $repoRoot "scripts\installer\pyqt")
$env:PYTHONPATH = "src"
$installerArgs = @(
    "-m", "gemma_installer.main",
    "--headless",
    "--install-path", $InstallPath,
    "--model", $Model,
    "--json-output"
)
if (-not $WithModel) { $installerArgs += "--skip-model" }

$installerJsonPath = Join-Path $resultsDir "installer.json"
python @installerArgs | Out-File -FilePath $installerJsonPath -Encoding utf8
$installerExit = $LASTEXITCODE
Pop-Location

Write-Header "Running component verification"
$verifyArgs = @(
    "tests\smoke\verify-components.py",
    "--install-path", $InstallPath,
    "--ollama-url", "http://localhost:11434"
)
if (-not $WithModel) { $verifyArgs += "--skip-model" }
$verifyArgs += "--skip-backend"

$verifyJsonPath = Join-Path $resultsDir "verify.json"
Push-Location $repoRoot
python @verifyArgs | Out-File -FilePath $verifyJsonPath -Encoding utf8
$verifyExit = $LASTEXITCODE
Pop-Location

Write-Header "Cleaning up"
Push-Location $repoRoot
python tests\smoke\cleanup.py --install-path $InstallPath
Pop-Location

if ($ollamaProc) { try { Stop-Process $ollamaProc -Force -ErrorAction SilentlyContinue } catch {} }

if ($installerExit -ne 0) { throw "installer exit $installerExit" }
if ($verifyExit -ne 0) { throw "verify exit $verifyExit" }

Write-Host "Smoke test PASSED. Results in $resultsDir"
