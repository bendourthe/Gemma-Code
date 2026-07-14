<#
.SYNOPSIS
    Runs INSIDE Windows Sandbox: executes the installer headless-smoke and
    drops the result + console log into the writable mapped output folder.

.DESCRIPTION
    v1.11.0 Phase 2 (T201). Invoked by the sandbox LogonCommand (see
    sandbox-config.wsb.template). Fixed sandbox-side paths:
      C:\NexusDist    (read-only)  - the host's dist/ with NexusSetup.exe
      C:\NexusTesting (read-only)  - this folder (bootstrap + profiles)
      C:\NexusOutput  (writable)   - result.json + console.log land here
#>
param(
    # Not named `Profile`: that is a PowerShell automatic variable.
    [string]$ProfileName = "sandbox-minimal"
)

$ErrorActionPreference = 'Continue'
$Exe = "C:\NexusDist\NexusSetup.exe"
$ProfilePath = "C:\NexusTesting\profiles\$ProfileName.json"
$ResultPath = "C:\NexusOutput\result.json"
$ConsoleLog = "C:\NexusOutput\console.log"

"[$(Get-Date -Format o)] sandbox-bootstrap starting (profile: $ProfileName)" |
    Out-File $ConsoleLog -Encoding utf8

if (-not (Test-Path $Exe)) {
    "FATAL: $Exe not found (is dist/ mapped?)" | Out-File $ConsoleLog -Append -Encoding utf8
    @{ schema = "nexus-smoke-result/v1"; profile = $ProfileName; success = $false;
       steps_failed = @("bootstrap"); logs = @(@{ level = "error";
       message = "NexusSetup.exe not found in the sandbox mapping" }) } |
        ConvertTo-Json -Depth 4 | Out-File $ResultPath -Encoding utf8
    exit 1
}

# Run the smoke. NexusSetup.exe is a WINDOWED app, so PowerShell's `&` would
# return immediately without an exit code; Start-Process -Wait is required.
# Redirection gives the frozen app real std handles, so its console output is
# captured for troubleshooting (two files: Start-Process cannot merge them).
$proc = Start-Process -FilePath $Exe -ArgumentList @(
    "--headless-smoke", $ProfilePath, "--smoke-output", $ResultPath
) -Wait -PassThru `
    -RedirectStandardOutput "C:\NexusOutput\stdout.log" `
    -RedirectStandardError "C:\NexusOutput\stderr.log"
$ExitCode = $proc.ExitCode
"[$(Get-Date -Format o)] NexusSetup.exe exited with $ExitCode" |
    Out-File $ConsoleLog -Append -Encoding utf8

# A missing result file means the exe died before writing it: synthesize one
# so the host runner always has something machine-readable to report.
if (-not (Test-Path $ResultPath)) {
    @{ schema = "nexus-smoke-result/v1"; profile = $ProfileName; success = $false;
       steps_failed = @("bootstrap"); exit_code = $ExitCode; logs = @(@{
       level = "error"; message = "installer exited $ExitCode without writing a result" }) } |
        ConvertTo-Json -Depth 4 | Out-File $ResultPath -Encoding utf8
}
exit $ExitCode
