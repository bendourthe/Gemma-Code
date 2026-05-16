<#
.SYNOPSIS
  v0.8.0 Phase 6.5 (item C6) -- Architecture linter wrapper.

.DESCRIPTION
  Runs dependency-cruiser via `npm run deps:check` and exits non-zero on
  any boundary violation. With `-Verbose` the script prints which modules
  triggered each violation; otherwise it summarises pass/fail only.

  Intended invocation surfaces:
    - scripts/init.ps1 -- contributors see boundary issues at setup time
    - CI               -- the .github/workflows/check-architecture.yml job

.PARAMETER Verbose
  Print the full depcruise output on failure.

.EXAMPLE
  pwsh -File scripts/check-architecture.ps1
  pwsh -File scripts/check-architecture.ps1 -Verbose
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "[ERROR] npm not found on PATH"
    exit 2
}

$logFile = New-TemporaryFile
try {
    $proc = Start-Process -FilePath "npm" `
        -ArgumentList @("run", "--silent", "deps:check") `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $logFile

    if ($proc.ExitCode -eq 0) {
        Write-Host "[INFO]  Architecture check passed."
        exit 0
    }

    if ($VerbosePreference -eq "Continue") {
        Write-Host "[ERROR] Architecture violations detected:" -ForegroundColor Red
        Get-Content $logFile | ForEach-Object { Write-Host $_ }
    } else {
        $violations = (Select-String -Path $logFile -Pattern "(error|violation)" -ErrorAction SilentlyContinue).Count
        Write-Host "[ERROR] Architecture violations: $violations. Re-run with -Verbose to inspect." -ForegroundColor Red
    }
    exit 1
}
finally {
    Remove-Item $logFile -ErrorAction SilentlyContinue
}
