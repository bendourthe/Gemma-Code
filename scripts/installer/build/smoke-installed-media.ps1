<#
.SYNOPSIS
    Validate real PNG and MP4 generation through the installed Nexus sidecar.

.DESCRIPTION
    Launches the exact Node sidecar bundled beside the installed desktop app,
    calls the same diffusion IPC methods as Image Studio and Video Lab, and
    writes a machine-readable evidence report. A unique disposable output
    directory is used for every run. CI stub output and prior-run artifacts
    cannot satisfy this check.
#>
[CmdletBinding()]
param(
    [string]$RuntimeConfig = (Join-Path $HOME '.nexus\runtime.json'),
    [string]$DesktopRoot = (Join-Path $env:LOCALAPPDATA 'Nexus AI Studio'),
    [string]$SidecarScript,
    [string]$InstallerPath,
    [string]$ReportPath,
    [string]$ImageModelId = 'realvisxl-v5',
    [string]$VideoModelId = 'wan2.1-t2v-1.3b',
    [int]$ImageSteps = 4,
    [int]$VideoSteps = 4,
    [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'
$attemptId = [Guid]::NewGuid().ToString('N')
$outputRoot = Join-Path ([IO.Path]::GetTempPath()) "nexus-media-smoke-$attemptId"
New-Item -ItemType Directory -Path $outputRoot | Out-Null
if (-not $ReportPath) { $ReportPath = Join-Path $outputRoot 'report.json' }
$reportParent = Split-Path -Parent $ReportPath
if ($reportParent -and -not (Test-Path -LiteralPath $reportParent -PathType Container)) {
    New-Item -ItemType Directory -Path $reportParent -Force | Out-Null
}

function Assert-Condition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Resolve-FirstFile {
    param([string[]]$Candidates)
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Invoke-SidecarRequest {
    param(
        [Diagnostics.Process]$Process,
        [int]$Id,
        [string]$Method,
        [hashtable]$Params,
        [int]$RequestTimeoutSeconds = 30
    )
    $payload = @{ jsonrpc = '2.0'; id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
    $Process.StandardInput.WriteLine($payload)
    $Process.StandardInput.Flush()
    while (-not $Process.HasExited) {
        $readTask = $Process.StandardOutput.ReadLineAsync()
        if (-not $readTask.Wait([TimeSpan]::FromSeconds($RequestTimeoutSeconds))) {
            throw "$Method timed out waiting for the packaged sidecar."
        }
        $line = $readTask.Result
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $message = $line | ConvertFrom-Json
        if ($message.id -ne $Id) { continue }
        if ($null -ne $message.error) { throw "$Method failed: $($message.error.message)" }
        return $message.result
    }
    throw "$Method failed because the packaged sidecar exited."
}

function Wait-Generation {
    param([Diagnostics.Process]$Process, [string]$JobId, [int]$FirstRequestId, [datetime]$Deadline)
    $requestId = $FirstRequestId
    while ([DateTime]::UtcNow -lt $Deadline) {
        $reply = Invoke-SidecarRequest -Process $Process -Id $requestId -Method 'diffusion.job.drainEvents' -Params @{ jobId = $JobId }
        $requestId++
        foreach ($event in @($reply.events)) {
            if ($event.kind -eq 'error') { throw "Generation $JobId failed: $($event.message)" }
            if ($event.kind -eq 'complete') { return $event }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Generation $JobId timed out after $TimeoutSeconds seconds."
}

function Get-PngEvidence {
    param([byte[]]$Bytes, [string]$Path)
    Assert-Condition ($Bytes.Length -gt 8) 'Image output is empty.'
    Assert-Condition ([BitConverter]::ToString($Bytes[0..7]) -eq '89-50-4E-47-0D-0A-1A-0A') 'Image output has no valid PNG signature.'
    [IO.File]::WriteAllBytes($Path, $Bytes)
    Add-Type -AssemblyName System.Drawing
    $stream = [IO.MemoryStream]::new($Bytes, $false)
    try {
        $bitmap = [Drawing.Bitmap]::new($stream)
        try {
            Assert-Condition ($bitmap.Width -ge 64 -and $bitmap.Height -ge 64) 'Decoded PNG dimensions are invalid.'
            $samples = [Collections.Generic.List[double]]::new()
            $strideX = [Math]::Max(1, [Math]::Floor($bitmap.Width / 16))
            $strideY = [Math]::Max(1, [Math]::Floor($bitmap.Height / 16))
            for ($x = 0; $x -lt $bitmap.Width; $x += $strideX) {
                for ($y = 0; $y -lt $bitmap.Height; $y += $strideY) {
                    $pixel = $bitmap.GetPixel($x, $y)
                    $samples.Add(($pixel.R + $pixel.G + $pixel.B) / 3.0)
                }
            }
            $mean = ($samples | Measure-Object -Average).Average
            $variance = (($samples | ForEach-Object { [Math]::Pow($_ - $mean, 2) }) | Measure-Object -Average).Average
            Assert-Condition ($variance -gt 0.01) 'Decoded PNG has zero visual variance.'
            return [ordered]@{
                path = $Path; bytes = $Bytes.Length; width = $bitmap.Width; height = $bitmap.Height
                sampledVariance = [Math]::Round($variance, 4)
                sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        } finally { $bitmap.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-VideoEvidence {
    param([string]$Path, [string]$Ffprobe)
    Assert-Condition (Test-Path -LiteralPath $Path -PathType Leaf) "Video output is missing: $Path"
    $header = [byte[]]::new(12)
    $stream = [IO.File]::OpenRead($Path)
    try { Assert-Condition ($stream.Read($header, 0, 12) -eq 12) 'Video output is too short.' } finally { $stream.Dispose() }
    Assert-Condition ([Text.Encoding]::ASCII.GetString($header, 4, 4) -eq 'ftyp') 'Video output has no valid MP4 file-type box.'
    $probeJson = & $Ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=codec_name,width,height,nb_read_frames,duration -show_entries format=duration,size -of json $Path
    Assert-Condition ($LASTEXITCODE -eq 0) 'ffprobe could not decode the generated video.'
    $probe = ($probeJson -join "`n") | ConvertFrom-Json
    $streamInfo = @($probe.streams)[0]
    Assert-Condition ($streamInfo.width -gt 0 -and $streamInfo.height -gt 0) 'Generated video has invalid dimensions.'
    Assert-Condition ([double]$probe.format.duration -gt 0) 'Generated video has no positive duration.'
    Assert-Condition ([int]$streamInfo.nb_read_frames -gt 0) 'Generated video has zero decoded frames.'
    return [ordered]@{
        path = (Resolve-Path -LiteralPath $Path).Path; bytes = [long]$probe.format.size; codec = [string]$streamInfo.codec_name
        durationSeconds = [double]$probe.format.duration; width = [int]$streamInfo.width; height = [int]$streamInfo.height
        frameCount = [int]$streamInfo.nb_read_frames; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

Assert-Condition (Test-Path -LiteralPath $RuntimeConfig -PathType Leaf) "Runtime contract not found: $RuntimeConfig"
$config = Get-Content -LiteralPath $RuntimeConfig -Raw | ConvertFrom-Json
Assert-Condition (Test-Path -LiteralPath $config.nodePath -PathType Leaf) "Installed Node runtime is missing: $($config.nodePath)"
if (-not $SidecarScript) {
    $SidecarScript = Resolve-FirstFile @((Join-Path $DesktopRoot 'sidecar\dist\main.js'), (Join-Path $DesktopRoot 'resources\sidecar\dist\main.js'))
}
Assert-Condition ($null -ne $SidecarScript) "Packaged sidecar not found beneath: $DesktopRoot"
if (-not $InstallerPath) {
    $InstallerPath = Resolve-FirstFile @((Join-Path $HOME 'Downloads\NexusSetup.exe'), (Join-Path $HOME 'Downloads\NexusSetup-2.4.1.exe'))
}
Assert-Condition ($null -ne $InstallerPath) 'Installer artifact not found. Pass -InstallerPath with the exact tested NexusSetup.exe.'
$pathFfprobe = Get-Command ffprobe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
$ffprobe = Resolve-FirstFile @((Join-Path $env:LOCALAPPDATA 'Nexus\runtime\ffmpeg\ffprobe.exe'), [string]$pathFfprobe)
Assert-Condition ($null -ne $ffprobe) 'ffprobe is missing from the installed media runtime and PATH.'
$desktopExe = Resolve-FirstFile @((Join-Path $DesktopRoot 'Nexus AI Studio.exe'), (Join-Path $DesktopRoot 'Nexus.exe'), (Join-Path $DesktopRoot 'nexus-shell.exe'))

$env:NEXUS_VIDEO_OUTPUT_DIR = $outputRoot
$env:NEXUS_VIDEO_OUTPUTS_DIR = $outputRoot
$env:NEXUS_DIFFUSION_ALLOW_STUB = '0'
$env:PYTHONUNBUFFERED = '1'
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = [string]$config.nodePath
$start.WorkingDirectory = Split-Path -Parent $SidecarScript
$start.Arguments = "`"$SidecarScript`""
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $false
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
Assert-Condition $process.Start() 'Could not start the packaged Nexus sidecar.'

$report = [ordered]@{
    schema = 'nexus-installed-media-smoke/v1'; attemptId = $attemptId; startedAt = [DateTime]::UtcNow.ToString('o')
    installer = @{ path = $InstallerPath; sha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    desktop = @{ path = $desktopExe; version = if ($desktopExe) { [Diagnostics.FileVersionInfo]::GetVersionInfo($desktopExe).ProductVersion } else { $null }; sidecar = $SidecarScript }
    runtime = @{ schemaVersion = $config.schemaVersion; pythonVersion = $config.diffusion.python_version; torchVersion = $config.diffusion.torch_version; cudaVersion = $config.diffusion.cuda_version; manifestFingerprint = $config.diffusion.manifest_fingerprint }
    catalog = @{ hash = if ($config.catalogHash) { $config.catalogHash } else { $null } }
    host = @{ gpu = $null; driver = $null; cuda = $null }; outputRoot = $outputRoot; image = $null; video = $null; passed = $false
}

try {
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($smi) {
        $gpuLine = & $smi.Source --query-gpu=name,driver_version --format=csv,noheader 2>$null | Select-Object -First 1
        if ($gpuLine) {
            $gpuParts = $gpuLine -split ',' | ForEach-Object { $_.Trim() }
            $report.host.gpu = $gpuParts[0]; $report.host.driver = $gpuParts[1]; $report.host.cuda = $config.diffusion.cuda_version
        }
    }
    $state = Invoke-SidecarRequest -Process $process -Id 1 -Method 'diffusion.runtime.status' -Params @{}
    Assert-Condition ($state.state -eq 'ready') "Packaged media runtime is not ready: $($state.code) $($state.message)"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $imageJob = Invoke-SidecarRequest -Process $process -Id 2 -Method 'diffusion.txt2img' -Params @{
        modelId = $ImageModelId; prompt = 'A small blue glass sphere on a neutral studio background'; negativePrompt = ''
        width = 512; height = 512; steps = $ImageSteps; cfgScale = 5.0; sampler = 'euler_a'; seed = 2401; batchSize = 1; latentPreview = $false
    } -RequestTimeoutSeconds $TimeoutSeconds
    $imageComplete = Wait-Generation -Process $process -JobId $imageJob.jobId -FirstRequestId 100 -Deadline $deadline
    Assert-Condition ($null -ne $imageComplete.png) 'Image job completed without PNG bytes.'
    $report.image = Get-PngEvidence -Bytes ([Convert]::FromBase64String([string]$imageComplete.png)) -Path (Join-Path $outputRoot "$attemptId.png")
    $videoJob = Invoke-SidecarRequest -Process $process -Id 3 -Method 'diffusion.video.text2video' -Params @{
        modelId = $VideoModelId; prompt = 'A blue glass sphere rotating slowly on a neutral studio background'; negativePrompt = ''
        width = 854; height = 480; durationSeconds = 1; fps = 12; steps = $VideoSteps; cfgScale = 5.0; sampler = 'euler_a'; seed = 2401; latentPreview = $false
    } -RequestTimeoutSeconds $TimeoutSeconds
    $videoComplete = Wait-Generation -Process $process -JobId $videoJob.jobId -FirstRequestId 10000 -Deadline $deadline
    Assert-Condition ($null -ne $videoComplete.outputPath) 'Video job completed without an output path.'
    $report.video = Get-VideoEvidence -Path ([string]$videoComplete.outputPath) -Ffprobe $ffprobe
    $report.passed = $true
} catch {
    $report['error'] = $_.Exception.Message
    throw
} finally {
    $report.finishedAt = [DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding utf8
    if (-not $process.HasExited) { try { $process.Kill($true) } catch { $process.Kill() } }
    $process.Dispose()
    Write-Host "Evidence report: $ReportPath"
}

Write-Host 'Installed media smoke passed.'
