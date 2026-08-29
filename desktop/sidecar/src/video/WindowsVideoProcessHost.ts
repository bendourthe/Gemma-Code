import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import {
  lstat,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  scrubVideoProcessEnv,
  type Avx2ProbeResult,
  type GuardedProcessRequest,
  type GuardedProcessResult,
  type GuardedVideoProcess,
} from "./GuardedVideoProcess.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_GRACE_MS = 250;
const DEFAULT_FORCE_MS = 1_000;
const DEFAULT_TERMINATION_ACK_MS = 100;
const MAX_CAPTURE_BYTES = 64 * 1024;
const WINDOWS_10_2004_BUILD = 19_041;
const MAX_REQUEST_TIMEOUT_MS = 86_400_000;
const MAX_ESCALATION_DELAY_MS = 60_000;
const HOST_WATCHDOG_MARGIN_MS = 5_000;
const MAX_HOST_WATCHDOG_MS =
  MAX_REQUEST_TIMEOUT_MS +
  MAX_ESCALATION_DELAY_MS * 2 +
  HOST_WATCHDOG_MARGIN_MS;
const WINDOWS_LOADER_ENV_ALLOWLIST = [
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
] as const;
const WINDOWS_HELPER_PATHEXT = ".COM;.EXE;.BAT;.CMD";

interface WindowsHostManifestBase {
  readonly schemaVersion: 1;
  readonly environment: Readonly<Record<string, string>>;
  readonly hostWatchdogMs: number;
}

interface WindowsHostRunManifest extends WindowsHostManifestBase {
  readonly mode: "run";
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

interface WindowsHostProbeManifest extends WindowsHostManifestBase {
  readonly mode: "probe-avx2";
}

type WindowsHostManifest = WindowsHostRunManifest | WindowsHostProbeManifest;

interface ControlDirectoryIdentity {
  readonly requestedRoot: string;
  readonly canonicalRoot: string;
  readonly directory: string;
  readonly canonicalDirectory: string;
  readonly device: number;
  readonly inode: number;
  readonly birthtimeMs: number;
}

type WindowsHostOperation =
  | {
      readonly mode: "run";
      readonly executable: string;
      readonly arguments: readonly string[];
      readonly cwd: string;
    }
  | {
      readonly mode: "probe-avx2";
    };

export interface WindowsVideoProcessHostOptions {
  readonly platform?: NodeJS.Platform;
  readonly windowsRelease?: string;
  readonly powershellPath?: string;
  readonly scratchRoot?: string;
  readonly spawnFn?: typeof spawn;
  readonly cleanupHostFn?: (root: string, directory: string) => Promise<void>;
}

export const WINDOWS_VIDEO_PROCESS_HOST_CSHARP = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class NexusVideoProcessHost {
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectExtendedLimitInformation = 9;
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint STARTF_USESTDHANDLES = 0x00000100;
  const uint HANDLE_FLAG_INHERIT = 0x00000001;
  const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
  const uint INFINITE = 0xFFFFFFFF;
  const uint WAIT_OBJECT_0 = 0x00000000;
  const uint WAIT_TIMEOUT = 0x00000102;
  const uint HOST_WATCHDOG_EXIT_CODE = 124;
  const uint HOST_TERMINATION_WAIT_MS = 5000;
  const int PF_AVX2_INSTRUCTIONS_AVAILABLE = 40;
  const int STD_INPUT_HANDLE = -10;
  const int STD_OUTPUT_HANDLE = -11;
  const int STD_ERROR_HANDLE = -12;

  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public uint cb;
    public IntPtr lpReserved;
    public IntPtr lpDesktop;
    public IntPtr lpTitle;
    public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
    public uint dwFillAttribute;
    public uint dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFOEX {
    public STARTUPINFO StartupInfo;
    public IntPtr lpAttributeList;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public uint dwProcessId;
    public uint dwThreadId;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessW(
    string applicationName,
    StringBuilder commandLine,
    IntPtr processAttributes,
    IntPtr threadAttributes,
    bool inheritHandles,
    uint creationFlags,
    IntPtr environment,
    string currentDirectory,
    [In] ref STARTUPINFOEX startupInfo,
    out PROCESS_INFORMATION processInformation
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(
    IntPtr list,
    uint flags,
    IntPtr attribute,
    IntPtr value,
    IntPtr size,
    IntPtr previousValue,
    IntPtr returnSize
  );

  [DllImport("kernel32.dll")]
  static extern void DeleteProcThreadAttributeList(IntPtr list);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetStdHandle(int stdHandle);

  [DllImport("kernel32.dll")]
  static extern bool IsProcessorFeaturePresent(int feature);

  public static bool ProbeAvx2() {
    return IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE);
  }

  public static int Run(
    string application,
    string[] arguments,
    string cwd,
    string[] environmentNames,
    string[] environmentValues,
    int watchdogMilliseconds
  ) {
    if (String.IsNullOrWhiteSpace(application)) throw new ArgumentException("application is required");
    if (arguments == null) throw new ArgumentNullException("arguments");
    if (String.IsNullOrWhiteSpace(cwd)) throw new ArgumentException("cwd is required");
    if (environmentNames == null) throw new ArgumentNullException("environmentNames");
    if (environmentValues == null) throw new ArgumentNullException("environmentValues");
    if (watchdogMilliseconds <= 0) throw new ArgumentOutOfRangeException("watchdogMilliseconds");

    IntPtr job = IntPtr.Zero;
    IntPtr jobInfo = IntPtr.Zero;
    IntPtr attributeList = IntPtr.Zero;
    IntPtr handleList = IntPtr.Zero;
    IntPtr environmentBlock = IntPtr.Zero;
    PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();
    bool processStarted = false;
    try {
      job = CreateJobObjectW(IntPtr.Zero, null);
      if (job == IntPtr.Zero) ThrowLast("CreateJobObjectW");

      var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      int jobInfoSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
      jobInfo = Marshal.AllocHGlobal(jobInfoSize);
      Marshal.StructureToPtr(limits, jobInfo, false);
      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, jobInfo, (uint)jobInfoSize)) {
        ThrowLast("SetInformationJobObject");
      }

      IntPtr stdin = GetStdHandle(STD_INPUT_HANDLE);
      IntPtr stdout = GetStdHandle(STD_OUTPUT_HANDLE);
      IntPtr stderr = GetStdHandle(STD_ERROR_HANDLE);
      EnsureInheritable(stdin, "stdin");
      EnsureInheritable(stdout, "stdout");
      EnsureInheritable(stderr, "stderr");

      IntPtr attributeSize = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
      if (attributeSize == IntPtr.Zero) ThrowLast("InitializeProcThreadAttributeList(size)");
      attributeList = Marshal.AllocHGlobal(attributeSize);
      if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize)) {
        ThrowLast("InitializeProcThreadAttributeList");
      }

      handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.WriteIntPtr(handleList, 0, stdin);
      Marshal.WriteIntPtr(handleList, IntPtr.Size, stdout);
      Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, stderr);
      if (!UpdateProcThreadAttribute(
        attributeList,
        0,
        new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST),
        handleList,
        new IntPtr(IntPtr.Size * 3),
        IntPtr.Zero,
        IntPtr.Zero
      )) {
        ThrowLast("UpdateProcThreadAttribute(HANDLE_LIST)");
      }

      var startup = new STARTUPINFOEX();
      startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
      startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
      startup.StartupInfo.hStdInput = stdin;
      startup.StartupInfo.hStdOutput = stdout;
      startup.StartupInfo.hStdError = stderr;
      startup.lpAttributeList = attributeList;

      var commandLine = new StringBuilder(BuildCommandLine(application, arguments));
      environmentBlock = BuildEnvironmentBlock(environmentNames, environmentValues);
      uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
      if (!CreateProcessW(
        application,
        commandLine,
        IntPtr.Zero,
        IntPtr.Zero,
        true,
        flags,
        environmentBlock,
        cwd,
        ref startup,
        out processInfo
      )) {
        ThrowLast("CreateProcessW");
      }
      processStarted = true;

      if (!AssignProcessToJobObject(job, processInfo.hProcess)) {
        TerminateProcess(processInfo.hProcess, 125);
        ThrowLast("AssignProcessToJobObject");
      }
      if (ResumeThread(processInfo.hThread) == 0xFFFFFFFF) {
        TerminateProcess(processInfo.hProcess, 125);
        ThrowLast("ResumeThread");
      }

      uint waitResult = WaitForSingleObject(processInfo.hProcess, (uint)watchdogMilliseconds);
      if (waitResult == WAIT_TIMEOUT) {
        if (!TerminateJobObject(job, HOST_WATCHDOG_EXIT_CODE)) {
          ThrowLast("TerminateJobObject(watchdog)");
        }
        uint terminationResult = WaitForSingleObject(processInfo.hProcess, HOST_TERMINATION_WAIT_MS);
        if (terminationResult != WAIT_OBJECT_0) {
          throw new InvalidOperationException("Process job did not terminate after watchdog expiry");
        }
        return unchecked((int)HOST_WATCHDOG_EXIT_CODE);
      }
      if (waitResult != WAIT_OBJECT_0) ThrowLast("WaitForSingleObject");
      uint code;
      if (!GetExitCodeProcess(processInfo.hProcess, out code)) ThrowLast("GetExitCodeProcess");
      return unchecked((int)code);
    } finally {
      if (processStarted) {
        if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
        if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
      }
      if (attributeList != IntPtr.Zero) {
        DeleteProcThreadAttributeList(attributeList);
        Marshal.FreeHGlobal(attributeList);
      }
      if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
      if (jobInfo != IntPtr.Zero) Marshal.FreeHGlobal(jobInfo);
      if (job != IntPtr.Zero) CloseHandle(job);
    }
  }

  static void EnsureInheritable(IntPtr handle, string name) {
    if (handle == IntPtr.Zero || handle == new IntPtr(-1)) {
      throw new InvalidOperationException("Missing standard " + name + " handle");
    }
    if (!SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
      ThrowLast("SetHandleInformation(" + name + ")");
    }
  }

  static string BuildCommandLine(string application, string[] arguments) {
    var result = new StringBuilder(QuoteArgument(application));
    foreach (string argument in arguments) {
      result.Append(' ');
      result.Append(QuoteArgument(argument));
    }
    return result.ToString();
  }

  static IntPtr BuildEnvironmentBlock(string[] names, string[] values) {
    if (names.Length != values.Length) {
      throw new ArgumentException("Environment names and values must have equal lengths");
    }
    var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (int index = 0; index < names.Length; index++) {
      string name = names[index];
      string value = values[index];
      if (String.IsNullOrEmpty(name) || name.IndexOf('=') >= 0 || name.IndexOf('\0') >= 0) {
        throw new ArgumentException("Invalid environment variable name");
      }
      if (value == null || value.IndexOf('\0') >= 0) {
        throw new ArgumentException("Invalid environment variable value");
      }
      if (variables.ContainsKey(name)) {
        throw new ArgumentException("Duplicate environment variable name");
      }
      variables.Add(name, value);
    }

    var block = new StringBuilder();
    foreach (KeyValuePair<string, string> variable in variables) {
      block.Append(variable.Key);
      block.Append('=');
      block.Append(variable.Value);
      block.Append('\0');
    }
    if (variables.Count == 0) block.Append('\0');
    block.Append('\0');
    char[] characters = block.ToString().ToCharArray();
    IntPtr pointer = Marshal.AllocHGlobal(checked(characters.Length * sizeof(char)));
    Marshal.Copy(characters, 0, pointer, characters.Length);
    return pointer;
  }

  public static string QuoteArgument(string argument) {
    if (argument == null) throw new ArgumentNullException("argument");
    if (argument.Length > 0 && argument.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) {
      return argument;
    }
    var result = new StringBuilder();
    result.Append('"');
    int backslashes = 0;
    foreach (char character in argument) {
      if (character == '\\') {
        backslashes++;
        continue;
      }
      if (character == '"') {
        result.Append('\\', backslashes * 2 + 1);
        result.Append('"');
        backslashes = 0;
        continue;
      }
      result.Append('\\', backslashes);
      backslashes = 0;
      result.Append(character);
    }
    result.Append('\\', backslashes * 2);
    result.Append('"');
    return result.ToString();
  }

  static void ThrowLast(string operation) {
    throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }
}
`;

export const WINDOWS_VIDEO_PROCESS_HOST_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$MaximumHostWatchdogMs = 86525000

function Assert-JsonObject {
  param([object]$Value, [string]$Context)
  if ($null -eq $Value -or $Value -is [System.Array] -or $Value -is [string] -or $Value -isnot [pscustomobject]) {
    throw "$Context must be a JSON object"
  }
}

function Assert-ExactProperties {
  param([object]$Value, [string[]]$Expected, [string]$Context)
  Assert-JsonObject $Value $Context
  [string[]]$Actual = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($Name in $Expected) {
    if ($Actual -cnotcontains $Name) { throw "$Context is missing field '$Name'" }
  }
  foreach ($Name in $Actual) {
    if ($Expected -cnotcontains $Name) { throw "$Context contains unknown field '$Name'" }
  }
}

function Assert-String {
  param([object]$Value, [string]$Context, [bool]$AllowEmpty = $false)
  if ($Value -isnot [string]) { throw "$Context must be a string" }
  if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($Value)) { throw "$Context must not be empty" }
  if ($Value.IndexOf([char]0) -ge 0) { throw "$Context must not contain NUL" }
}

function Assert-Integer {
  param([object]$Value, [long]$Minimum, [long]$Maximum, [string]$Context)
  if (($Value -isnot [int]) -and ($Value -isnot [long])) { throw "$Context must be an integer" }
  if ([long]$Value -lt $Minimum -or [long]$Value -gt $Maximum) {
    throw "$Context must be between $Minimum and $Maximum"
  }
}

function Get-RequiredHelperEnvironment {
  param([string]$Name)
  $Value = [Environment]::GetEnvironmentVariable($Name, [EnvironmentVariableTarget]::Process)
  Assert-String $Value "helper environment '$Name'"
  return $Value
}

function Get-AuthenticatedUtf8File {
  param([string]$Path, [string]$ExpectedSha256, [string]$Label)
  Assert-String $Path "$Label path"
  Assert-String $ExpectedSha256 "$Label SHA-256"
  if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') { throw "$Label SHA-256 is invalid" }
  [byte[]]$Bytes = [IO.File]::ReadAllBytes($Path)
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $ActualSha256 = ([BitConverter]::ToString($Hasher.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
  }
  if ($ActualSha256 -cne $ExpectedSha256) { throw "$Label authentication failed" }
  $Decoder = New-Object Text.UTF8Encoding($false, $true)
  return $Decoder.GetString($Bytes)
}

$ManifestPath = Get-RequiredHelperEnvironment 'NEXUS_VIDEO_HOST_MANIFEST_PATH'
$ManifestSha256 = Get-RequiredHelperEnvironment 'NEXUS_VIDEO_HOST_MANIFEST_SHA256'
$SourcePath = Get-RequiredHelperEnvironment 'NEXUS_VIDEO_HOST_SOURCE_PATH'
$SourceSha256 = Get-RequiredHelperEnvironment 'NEXUS_VIDEO_HOST_SOURCE_SHA256'

$manifest = $null
try {
  $manifestJson = Get-AuthenticatedUtf8File $ManifestPath $ManifestSha256 'Manifest'
  $manifest = $manifestJson | ConvertFrom-Json
  Assert-JsonObject $manifest 'process-host manifest'
  $ModeProperty = $manifest.PSObject.Properties | Where-Object { $_.Name -ceq 'mode' }
  if ($null -eq $ModeProperty) { throw "process-host manifest is missing field 'mode'" }
  Assert-String $ModeProperty.Value 'process-host mode'

  if ($ModeProperty.Value -ceq 'run') {
    Assert-ExactProperties $manifest @(
      'schemaVersion',
      'mode',
      'executable',
      'arguments',
      'cwd',
      'environment',
      'hostWatchdogMs'
    ) 'run process-host manifest'
  } elseif ($ModeProperty.Value -ceq 'probe-avx2') {
    Assert-ExactProperties $manifest @(
      'schemaVersion',
      'mode',
      'environment',
      'hostWatchdogMs'
    ) 'probe process-host manifest'
  } else {
    throw 'Unsupported process-host mode'
  }

  Assert-Integer $manifest.schemaVersion 1 1 'process-host schemaVersion'
  Assert-Integer $manifest.hostWatchdogMs 1 $MaximumHostWatchdogMs 'process-host hostWatchdogMs'
  Assert-JsonObject $manifest.environment 'process-host environment'
  foreach ($Property in $manifest.environment.PSObject.Properties) {
    Assert-String $Property.Name 'environment variable name'
    if ($Property.Name.IndexOf('=') -ge 0) { throw 'Environment variable name must not contain equals' }
    Assert-String $Property.Value "environment variable '$($Property.Name)'" $true
  }

  if ($ModeProperty.Value -ceq 'run') {
    Assert-String $manifest.executable 'process-host executable'
    Assert-String $manifest.cwd 'process-host cwd'
    if ($manifest.arguments -isnot [System.Array]) { throw 'process-host arguments must be an array' }
    foreach ($Argument in $manifest.arguments) {
      Assert-String $Argument 'process-host argument' $true
    }
  }
} finally {
  Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction Stop
}

$source = Get-AuthenticatedUtf8File $SourcePath $SourceSha256 'Native source'
Add-Type -TypeDefinition $source -Language CSharp
if ($manifest.mode -eq 'probe-avx2') {
  if ([NexusVideoProcessHost]::ProbeAvx2()) { Write-Output '{"avx2":true}'; exit 0 }
  Write-Output '{"avx2":false}'; exit 3
}
$arguments = [string[]]$manifest.arguments
[object[]]$EnvironmentProperties = @($manifest.environment.PSObject.Properties | Sort-Object -Property Name)
[string[]]$EnvironmentNames = @($EnvironmentProperties | ForEach-Object { $_.Name })
[string[]]$EnvironmentValues = @($EnvironmentProperties | ForEach-Object { [string]$_.Value })
$exitCode = [NexusVideoProcessHost]::Run(
  [string]$manifest.executable,
  $arguments,
  [string]$manifest.cwd,
  $EnvironmentNames,
  $EnvironmentValues,
  [int]$manifest.hostWatchdogMs
)
exit $exitCode
`;

export const WINDOWS_VIDEO_PROCESS_HOST_ENCODED_COMMAND = Buffer.from(
  WINDOWS_VIDEO_PROCESS_HOST_PS1,
  "utf16le",
).toString("base64");

export function quoteWindowsArgument(argument: string): string {
  if (!/[\s"]/u.test(argument) && argument.length > 0) return argument;
  let result = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + "\\".repeat(backslashes * 2) + '"';
}

export function buildWindowsCommandLine(
  executable: string,
  args: readonly string[],
): string {
  return [executable, ...args].map(quoteWindowsArgument).join(" ");
}

export function parseWindowsBuild(release: string): number | null {
  const parts = release.split(".");
  if (parts.length < 3) return null;
  const build = Number(parts[2]);
  return Number.isSafeInteger(build) && build >= 0 ? build : null;
}

function appendBounded(current: string, chunk: string): string {
  const currentBytes = Buffer.from(current, "utf8");
  const chunkBytes = Buffer.from(chunk, "utf8");
  if (currentBytes.length + chunkBytes.length <= MAX_CAPTURE_BYTES) {
    return current + chunk;
  }
  const combined =
    chunkBytes.length >= MAX_CAPTURE_BYTES
      ? chunkBytes
      : Buffer.concat([
          currentBytes.subarray(
            Math.max(
              0,
              currentBytes.length - (MAX_CAPTURE_BYTES - chunkBytes.length),
            ),
          ),
          chunkBytes,
        ]);
  let start = Math.max(0, combined.length - MAX_CAPTURE_BYTES);
  while (start < combined.length && (combined[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  return combined.subarray(start).toString("utf8");
}

function defaultPowerShellPath(): string {
  return path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Process-host helper directory escaped its private root");
  }
}

async function prepareHost(
  root: string,
  manifest: WindowsHostManifest,
  cleanup: (identity: ControlDirectoryIdentity) => Promise<void>,
): Promise<{
  readonly identity: ControlDirectoryIdentity;
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}> {
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const directory = await mkdtemp(
    path.join(canonicalRoot, ".nexus-video-host-"),
  );
  assertContained(canonicalRoot, directory);
  const canonicalDirectory = await realpath(directory);
  assertContained(canonicalRoot, canonicalDirectory);
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Process-host control path is not a private directory");
  }
  const identity: ControlDirectoryIdentity = {
    requestedRoot: root,
    canonicalRoot,
    directory,
    canonicalDirectory,
    device: directoryStat.dev,
    inode: directoryStat.ino,
    birthtimeMs: directoryStat.birthtimeMs,
  };
  const sourcePath = path.join(directory, "NexusVideoProcessHost.cs");
  const manifestPath = path.join(directory, "request.json");
  const manifestJson = JSON.stringify(manifest);
  const manifestSha256 = createHash("sha256")
    .update(manifestJson, "utf8")
    .digest("hex");
  const sourceSha256 = createHash("sha256")
    .update(WINDOWS_VIDEO_PROCESS_HOST_CSHARP, "utf8")
    .digest("hex");
  try {
    await writeFile(sourcePath, WINDOWS_VIDEO_PROCESS_HOST_CSHARP, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(manifestPath, manifestJson, {
      encoding: "utf8",
      flag: "wx",
    });
    return {
      identity,
      directory,
      manifestPath,
      manifestSha256,
      sourcePath,
      sourceSha256,
    };
  } catch (error) {
    try {
      await cleanup(identity);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Process-host preparation and cleanup both failed",
      );
    }
    throw error;
  }
}

async function validateControlDirectoryIdentity(
  identity: ControlDirectoryIdentity,
): Promise<void> {
  const currentRoot = await realpath(identity.requestedRoot);
  if (path.relative(identity.canonicalRoot, currentRoot) !== "") {
    throw new Error("Process-host control root identity changed");
  }
  const currentStat = await lstat(identity.directory);
  if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
    throw new Error("Process-host control directory type changed");
  }
  const currentDirectory = await realpath(identity.directory);
  assertContained(identity.canonicalRoot, currentDirectory);
  if (
    path.relative(identity.canonicalDirectory, currentDirectory) !== "" ||
    currentStat.dev !== identity.device ||
    currentStat.ino !== identity.inode ||
    currentStat.birthtimeMs !== identity.birthtimeMs
  ) {
    throw new Error("Process-host control directory identity changed");
  }
}

async function cleanupHost(identity: ControlDirectoryIdentity): Promise<void> {
  await validateControlDirectoryIdentity(identity);
  await rm(identity.directory, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

function emptyCancelledResult(stderr = ""): GuardedProcessResult {
  return {
    exitCode: null,
    stdout: "",
    stderr,
    timedOut: false,
    cancelled: true,
    terminationConfirmed: true,
  };
}

function normalizeEscalationDelay(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0 ||
    normalized > MAX_ESCALATION_DELAY_MS
  ) {
    throw new Error(name + " must be between 0 and " + MAX_ESCALATION_DELAY_MS);
  }
  return normalized;
}

function toManifestEnvironment(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function pinnedWindowsHelperPath(systemRoot: string): string {
  return [
    path.join(systemRoot, "System32"),
    path.join(systemRoot, "System32", "Wbem"),
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    path.join(systemRoot, "Microsoft.NET", "Framework64", "v4.0.30319"),
  ].join(";");
}

function buildWindowsLoaderEnvironment(): NodeJS.ProcessEnv {
  const scrubbedHostEnvironment = scrubVideoProcessEnv(process.env);
  const available = new Map(
    Object.entries(scrubbedHostEnvironment).map(([name, value]) => [
      name.toUpperCase(),
      value,
    ]),
  );
  const loaderEnvironment: NodeJS.ProcessEnv = {};
  for (const canonicalName of WINDOWS_LOADER_ENV_ALLOWLIST) {
    const value = available.get(canonicalName.toUpperCase());
    if (value !== undefined) loaderEnvironment[canonicalName] = value;
  }
  const systemRoot =
    loaderEnvironment.SystemRoot ??
    loaderEnvironment.WINDIR ??
    "C:\\Windows";
  // Pin PATH to Windows roots so Add-Type can find csc.exe. Never copy
  // process PATH (it can include attacker directories).
  loaderEnvironment.PATH = pinnedWindowsHelperPath(systemRoot);
  loaderEnvironment.PATHEXT = WINDOWS_HELPER_PATHEXT;
  return loaderEnvironment;
}

export function createWindowsVideoProcessHost(
  options: WindowsVideoProcessHostOptions = {},
): GuardedVideoProcess {
  const platform = options.platform ?? process.platform;
  const windowsRelease = options.windowsRelease ?? os.release();
  const powershellPath = options.powershellPath ?? defaultPowerShellPath();
  const scratchRoot =
    options.scratchRoot ?? path.join(os.tmpdir(), "nexus-video-host");
  const spawnFn = options.spawnFn ?? spawn;
  const cleanup =
    options.cleanupHostFn === undefined
      ? cleanupHost
      : async (identity: ControlDirectoryIdentity): Promise<void> => {
          await validateControlDirectoryIdentity(identity);
          await options.cleanupHostFn!(
            identity.requestedRoot,
            identity.directory,
          );
        };

  async function execute(
    operation: WindowsHostOperation,
    request: GuardedProcessRequest,
  ): Promise<GuardedProcessResult> {
    if (request.signal?.aborted) return emptyCancelledResult();
    if (
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs <= 0 ||
      request.timeoutMs > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw new Error(
        "timeoutMs must be between 1 and " + MAX_REQUEST_TIMEOUT_MS,
      );
    }
    const gracefulShutdownMs = normalizeEscalationDelay(
      request.gracefulShutdownMs,
      DEFAULT_GRACE_MS,
      "gracefulShutdownMs",
    );
    const forceKillMs = normalizeEscalationDelay(
      request.forceKillMs,
      DEFAULT_FORCE_MS,
      "forceKillMs",
    );
    const hostWatchdogMs =
      request.timeoutMs +
      gracefulShutdownMs +
      forceKillMs +
      HOST_WATCHDOG_MARGIN_MS;
    if (hostWatchdogMs > MAX_HOST_WATCHDOG_MS) {
      throw new Error("host watchdog must not exceed " + MAX_HOST_WATCHDOG_MS);
    }
    if (!fs.existsSync(powershellPath)) {
      return {
        exitCode: null,
        stdout: "",
        stderr: "Windows process host is unavailable",
        timedOut: false,
        cancelled: false,
        terminationConfirmed: true,
      };
    }

    const cleanEnvironment = scrubVideoProcessEnv(request.env);
    const manifestEnvironment = toManifestEnvironment(cleanEnvironment);
    const manifest: WindowsHostManifest =
      operation.mode === "run"
        ? {
            schemaVersion: 1,
            mode: "run",
            executable: operation.executable,
            arguments: operation.arguments,
            cwd: operation.cwd,
            environment: manifestEnvironment,
            hostWatchdogMs,
          }
        : {
            schemaVersion: 1,
            mode: "probe-avx2",
            environment: manifestEnvironment,
            hostWatchdogMs,
          };
    const host = await prepareHost(scratchRoot, manifest, cleanup);
    if (request.signal?.aborted) {
      try {
        await cleanup(host.identity);
        return emptyCancelledResult();
      } catch {
        return emptyCancelledResult(
          "Process-host cleanup failed after cancellation.",
        );
      }
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      const helperEnvironment: NodeJS.ProcessEnv = {
        ...buildWindowsLoaderEnvironment(),
        NEXUS_VIDEO_HOST_MANIFEST_PATH: host.manifestPath,
        NEXUS_VIDEO_HOST_MANIFEST_SHA256: host.manifestSha256,
        NEXUS_VIDEO_HOST_SOURCE_PATH: host.sourcePath,
        NEXUS_VIDEO_HOST_SOURCE_SHA256: host.sourceSha256,
      };
      child = spawnFn(
        powershellPath,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          WINDOWS_VIDEO_PROCESS_HOST_ENCODED_COMMAND,
        ],
        {
          cwd: host.directory,
          env: helperEnvironment,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      ) as ChildProcessWithoutNullStreams;
    } catch (error) {
      try {
        await cleanup(host.identity);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Process-host spawn and cleanup both failed",
        );
      }
      throw error;
    }

    child.stdin.on("error", () => {
      // Redirected stdin is best-effort. Terminating the host closes the job
      // handle and remains the authoritative descendant-kill boundary.
    });

    let result: GuardedProcessResult | undefined;
    let executionError: unknown;
    try {
      result = await new Promise<GuardedProcessResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let stopReason: "cancel" | "timeout" | null = null;
        let stopping = false;
        let settled = false;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        let stopTimer: ReturnType<typeof setTimeout> | undefined;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        let acknowledgementTimer: ReturnType<typeof setTimeout> | undefined;

        const terminateHost = (): void => {
          try {
            child.kill();
          } catch {
            // Host already exited. Closing its job handle is authoritative.
          }
        };
        const finish = (
          exitCode: number | null,
          terminationConfirmed: boolean,
          diagnostic?: string,
        ): void => {
          if (settled) return;
          settled = true;
          if (diagnostic !== undefined) {
            stderr = appendBounded(stderr, diagnostic);
          }
          if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
          if (stopTimer !== undefined) clearTimeout(stopTimer);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          if (acknowledgementTimer !== undefined)
            clearTimeout(acknowledgementTimer);
          request.signal?.removeEventListener("abort", onAbort);
          child.stdout.removeListener("data", onStdout);
          child.stderr.removeListener("data", onStderr);
          child.stdout.pause();
          child.stderr.pause();
          child.removeListener("error", onError);
          child.removeListener("close", onClose);
          resolve({
            exitCode,
            stdout,
            stderr,
            timedOut: stopReason === "timeout",
            cancelled: stopReason === "cancel",
            terminationConfirmed,
          });
        };
        const forceStop = (): void => {
          terminateHost();
          if (settled) return;
          acknowledgementTimer = setTimeout(
            () =>
              finish(
                null,
                false,
                "\nWindows process-host termination was not acknowledged.",
              ),
            DEFAULT_TERMINATION_ACK_MS,
          );
        };
        const beginStop = (reason: "cancel" | "timeout"): void => {
          if (reason === "cancel" || stopReason === null) stopReason = reason;
          if (stopping) return;
          stopping = true;
          try {
            child.stdin.write(request.graceInput ?? "q\n");
          } catch {
            // Redirected input is best-effort only.
          }
          stopTimer = setTimeout(() => {
            terminateHost();
            if (settled) return;
            forceTimer = setTimeout(forceStop, forceKillMs);
          }, gracefulShutdownMs);
        };

        const onAbort = (): void => beginStop("cancel");
        const onStdout = (data: Buffer | string): void => {
          const chunk = data.toString();
          stdout = appendBounded(stdout, chunk);
          try {
            request.onStdout?.(chunk);
          } catch {
            // A capture consumer cannot control the subprocess lifecycle.
          }
        };
        const onStderr = (data: Buffer | string): void => {
          const chunk = data.toString();
          stderr = appendBounded(stderr, chunk);
          try {
            request.onStderr?.(chunk);
          } catch {
            // A capture consumer cannot control the subprocess lifecycle.
          }
        };
        const onError = (error: Error): void => {
          stderr = appendBounded(stderr, error.message);
        };
        const onClose = (exitCode: number | null): void =>
          finish(exitCode, true);

        child.stdout.on("data", onStdout);
        child.stderr.on("data", onStderr);
        child.once("error", onError);
        child.once("close", onClose);
        request.signal?.addEventListener("abort", onAbort, { once: true });
        timeoutTimer = setTimeout(
          () => beginStop("timeout"),
          request.timeoutMs,
        );
        if (request.signal?.aborted) beginStop("cancel");
      });
    } catch (error) {
      executionError = error;
    }

    try {
      await cleanup(host.identity);
    } catch (cleanupError) {
      if (result?.cancelled || result?.timedOut) {
        return {
          ...result,
          stderr: appendBounded(
            result.stderr,
            "\nProcess-host cleanup failed after authoritative stop.",
          ),
        };
      }
      if (executionError !== undefined) {
        throw new AggregateError(
          [executionError, cleanupError],
          "Process-host execution and cleanup both failed",
        );
      }
      throw cleanupError;
    }
    if (executionError !== undefined) throw executionError;
    if (result === undefined) {
      throw new Error("Process-host execution completed without a result");
    }
    return result;
  }

  return {
    async probeAvx2(): Promise<Avx2ProbeResult> {
      if (platform !== "win32") {
        return {
          status: "unavailable",
          reason: "process_host_unavailable",
          detail: "Windows AVX2 host is not active",
        };
      }
      const build = parseWindowsBuild(windowsRelease);
      if (build === null || build < WINDOWS_10_2004_BUILD) {
        return {
          status: "unavailable",
          reason: "cpu_probe_failed",
          detail:
            "Windows 10 version 2004 or later is required for AVX2 detection",
        };
      }
      let result: GuardedProcessResult;
      try {
        result = await execute(
          { mode: "probe-avx2" },
          {
            executable: powershellPath,
            args: [],
            cwd: scratchRoot,
            env: scrubVideoProcessEnv(process.env),
            timeoutMs: DEFAULT_TIMEOUT_MS,
          },
        );
      } catch {
        return {
          status: "unavailable",
          reason: "process_host_unavailable",
          detail: "Windows AVX2 process host failed",
        };
      }
      if (
        result.timedOut ||
        result.exitCode === null ||
        !result.terminationConfirmed
      ) {
        return {
          status: "unavailable",
          reason: "process_host_unavailable",
          detail: "Windows AVX2 probe failed",
        };
      }
      if (result.exitCode === 0 && /"avx2"\s*:\s*true/i.test(result.stdout)) {
        return { status: "supported" };
      }
      if (result.exitCode === 3 && /"avx2"\s*:\s*false/i.test(result.stdout)) {
        return {
          status: "unavailable",
          reason: "cpu_probe_failed",
          detail: "Windows AVX2 evidence was unavailable",
        };
      }
      return {
        status: "unavailable",
        reason: "process_host_unavailable",
        detail: "Windows AVX2 probe was indeterminate",
      };
    },

    async run(request: GuardedProcessRequest): Promise<GuardedProcessResult> {
      if (platform !== "win32") {
        throw new Error(
          "Windows Video2X process host is available only on win32",
        );
      }
      return await execute(
        {
          mode: "run",
          executable: request.executable,
          arguments: request.args,
          cwd: request.cwd,
        },
        request,
      );
    },
  };
}
