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

# Refresh PATH from the registry: tools that the CI workflow just installed
# (e.g. Chocolatey-provided VS Code) write their bin directories to the User /
# Machine PATH, but PowerShell's $env:Path is captured at process launch. Merge
# both registry layers in so Test-Command sees the freshly-installed tools.
function Update-PathFromRegistry {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $segments = @($machinePath, $userPath, $env:Path) |
        Where-Object { $_ } |
        ForEach-Object { $_ -split ';' } |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -ErrorAction SilentlyContinue) }
    $env:Path = ($segments | Select-Object -Unique) -join ';'
}

Update-PathFromRegistry

Write-Header "Checking prerequisites"
if (-not (Test-Command code)) { throw "VS Code (code CLI) not on PATH" }
if (-not (Test-Command python)) { throw "Python 3.11+ not on PATH" }

Write-Header "Ensuring Ollama is installed"
if (-not (Test-Command ollama)) {
    Write-Host "  installing Ollama via winget..."
    winget install --exact --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements | Out-Null
    # winget writes Ollama's bin directory to the User PATH, but this process's
    # $env:Path was captured before the install ran. Refresh from the registry
    # so the freshly-installed `ollama` is resolvable in this same session
    # (otherwise Start-Process below fails with "cannot find the file").
    Update-PathFromRegistry
}

Write-Header "Starting Ollama service (background)"
$ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollamaExe) { throw "ollama not on PATH after install" }
# Capture the serve process output so a cold-start failure is diagnosable (the
# server runs detached, so its stdout/stderr would otherwise be lost). The two
# redirect targets must be distinct files.
$ollamaOut = Join-Path $resultsDir "ollama-serve.out.log"
$ollamaErrLog = Join-Path $resultsDir "ollama-serve.err.log"
$ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList "serve" -PassThru -NoNewWindow `
    -RedirectStandardOutput $ollamaOut -RedirectStandardError $ollamaErrLog
Start-Sleep -Seconds 3

# Poll /api/tags. Windows runners cold-start Ollama slowly (the first `serve`
# unpacks the runtime), so allow up to 180s -- 60s was not enough on the hosted
# windows-latest runner. Surface the serve log + process state if it never binds.
$deadline = (Get-Date).AddSeconds(180)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 | Out-Null
        $ready = $true; break
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) {
    Write-Host "Ollama did not respond within 180s (serve exited: $($ollamaProc.HasExited))"
    if (Test-Path $ollamaErrLog) { Write-Host "--- ollama serve stderr (tail) ---"; Get-Content $ollamaErrLog -Tail 40 }
    if (Test-Path $ollamaOut) { Write-Host "--- ollama serve stdout (tail) ---"; Get-Content $ollamaOut -Tail 40 }
    throw "Ollama failed to respond within 180 seconds"
}

Write-Header "Running installer in headless mode"
Push-Location (Join-Path $repoRoot "scripts\installer\pyqt")
$env:PYTHONPATH = "src"
$installerArgs = @(
    "-m", "nexus_installer.main",
    "--headless",
    "--install-path", $InstallPath,
    "--model", $Model,
    "--json-output",
    # The smoke checkout has no built VSIX to install.
    "--skip-extension"
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
$verifyArgs += "--skip-extension"

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
