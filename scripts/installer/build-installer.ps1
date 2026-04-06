#Requires -Version 5.1
<#
.SYNOPSIS
    Build the Gemma Code Windows installer (setup.exe).

.DESCRIPTION
    Orchestrates the full installer build:
      1. Build the VSIX via scripts/build-vsix.ps1
      2. Export Python backend requirements from uv
      3. Compile the NSIS installer script
      4. Optionally sign the output with a self-signed certificate (dev builds)

.PARAMETER SkipSign
    Skip code signing (required when no certificate is available).

.PARAMETER NsisPath
    Override the path to makensis.exe. Auto-detected from common install locations.
#>
[CmdletBinding()]
param(
    [switch]$SkipSign,
    [string]$NsisPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ─────────────────────────────────────────────────────────────────

function Log-Step    { param([string]$m) Write-Host "[BUILD] $m" -ForegroundColor Cyan    }
function Log-Success { param([string]$m) Write-Host "[OK]    $m" -ForegroundColor Green   }
function Log-Error   { param([string]$m) Write-Host "[FAIL]  $m" -ForegroundColor Red     }

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

# ── Paths ────────────────────────────────────────────────────────────────────

$RepoRoot      = (Resolve-Path "$PSScriptRoot\..\..")
$InstallerDir  = $PSScriptRoot
$BackendDir    = Join-Path $RepoRoot 'src\backend'
$ReqFile       = Join-Path $InstallerDir 'backend-requirements.txt'
$NsiScript     = Join-Path $InstallerDir 'setup.nsi'
$VsixPath      = Join-Path $RepoRoot 'gemma-code-0.1.0.vsix'
$SetupExe      = Join-Path $InstallerDir 'setup.exe'

Push-Location $RepoRoot

try {

    # ── Step 1: Build VSIX ───────────────────────────────────────────────────

    Invoke-Step 'Build VSIX package' {
        & pwsh -NonInteractive -File (Join-Path $RepoRoot 'scripts\build-vsix.ps1')
    }

    # Verify VSIX was created
    if (-not (Test-Path $VsixPath)) {
        Log-Error "VSIX not found at $VsixPath"
        exit 1
    }

    # Copy VSIX next to NSI script so NSIS can embed it
    Copy-Item $VsixPath -Destination $InstallerDir -Force
    Log-Success "VSIX copied to installer directory"

    # ── Step 2: Export Python backend requirements ───────────────────────────

    Invoke-Step 'Export Python backend requirements (uv export)' {
        Push-Location $BackendDir
        try {
            uv export --no-dev --format requirements-txt --output-file $ReqFile
        } finally {
            Pop-Location
        }
    }

    # ── Step 3: Locate NSIS ──────────────────────────────────────────────────

    if (-not $NsisPath) {
        $Candidates = @(
            'C:\Program Files (x86)\NSIS\makensis.exe',
            'C:\Program Files\NSIS\makensis.exe',
            (Get-Command makensis -ErrorAction SilentlyContinue)?.Source
        ) | Where-Object { $_ -and (Test-Path $_) }

        if (-not $Candidates) {
            Log-Error 'makensis.exe not found. Install NSIS from https://nsis.sourceforge.io'
            exit 1
        }
        $NsisPath = $Candidates[0]
    }
    Log-Step "Using NSIS: $NsisPath"

    # ── Step 4: Compile NSIS installer ───────────────────────────────────────

    Invoke-Step 'Compile NSIS installer script' {
        & $NsisPath `
            /DPRODUCT_VERSION="0.1.0" `
            /V2 `
            $NsiScript
    }

    # ── Step 5: Code sign (dev self-signed cert) ─────────────────────────────

    if (-not $SkipSign) {
        Invoke-Step 'Sign setup.exe with self-signed certificate' {
            # Create a self-signed cert if one doesn't exist in the store
            $Cert = Get-ChildItem Cert:\CurrentUser\My |
                    Where-Object { $_.Subject -like '*GemmaCode*' } |
                    Select-Object -First 1

            if (-not $Cert) {
                Log-Step 'Generating self-signed code-signing certificate...'
                $Cert = New-SelfSignedCertificate `
                    -Subject        'CN=GemmaCode Dev, O=GemmaCode, C=US' `
                    -Type           CodeSigningCert `
                    -CertStoreLocation Cert:\CurrentUser\My `
                    -KeyUsage       DigitalSignature `
                    -KeyAlgorithm   RSA `
                    -KeyLength      2048 `
                    -HashAlgorithm  SHA256 `
                    -NotAfter       (Get-Date).AddYears(1)
                Log-Success "Self-signed cert created: $($Cert.Thumbprint)"
            }

            Set-AuthenticodeSignature `
                -FilePath    $SetupExe `
                -Certificate $Cert `
                -TimestampServer 'http://timestamp.digicert.com' | Out-Null

            $Sig = Get-AuthenticodeSignature $SetupExe
            if ($Sig.Status -ne 'Valid' -and $Sig.Status -ne 'UnknownError') {
                # UnknownError is expected for self-signed without a trusted root
                Log-Error "Signing status: $($Sig.Status)"
                exit 1
            }
            Log-Success "Signed: $SetupExe"
            0
        }
    } else {
        Log-Step 'Skipping code signing (-SkipSign)'
    }

} finally {
    Pop-Location
}

Write-Host ''
Write-Host "Installer ready: $SetupExe" -ForegroundColor Green
