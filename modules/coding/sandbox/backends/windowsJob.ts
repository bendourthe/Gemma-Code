/**
 * Windows job-object + restricted-token backend.
 *
 * Launches cmd.exe /d /s /c <command> inside a job (kill-on-close, process and
 * memory caps) with CREATE_SUSPENDED so the child cannot break away before
 * assignment. Restricted token is best-effort. Filesystem and network policy
 * dimensions are not enforced; see windowsMatrix.ts.
 *
 * `# DEVIATION:` AppContainer is not applied (capability SIDs break typical
 * coding CLIs). Mode is therefore never "confined" on Windows. Restricted
 * token uses CreateProcessWithTokenW and falls back to the current token in
 * the job when the host lacks the assign-primary privilege.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { reportFromCapability } from "../report.js";
import type {
  SandboxBackend,
  SandboxCapability,
  SandboxPolicy,
  SandboxPrepared,
  SandboxSpawnRequest,
} from "../types.js";
import { findOnPath } from "../which.js";
import {
  WINDOWS_ENFORCED_DIMENSIONS,
  WINDOWS_UNENFORCED_DIMENSIONS,
} from "../windowsMatrix.js";

export function probeWindowsJob(
  platform: NodeJS.Platform = process.platform,
): SandboxCapability {
  if (platform !== "win32") {
    return {
      platform,
      backendId: "windows-job",
      available: false,
      detail: "Job objects are a Windows backend",
      enforced: [],
      unenforced: ["filesystem", "network", "process-limits", "restricted-token"],
    };
  }
  const powershell =
    findOnPath(["pwsh", "powershell"]) ??
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
  const available = fs.existsSync(powershell);
  return {
    platform,
    backendId: "windows-job",
    available,
    detail: available
      ? "job object + restricted token (filesystem and network NOT kernel-enforced; see WINDOWS_ENFORCEMENT_MATRIX)"
      : "powershell.exe missing; cannot create a job object from Node (degraded)",
    enforced: available ? WINDOWS_ENFORCED_DIMENSIONS : [],
    unenforced: available
      ? WINDOWS_UNENFORCED_DIMENSIONS
      : ["filesystem", "network", "process-limits", "restricted-token"],
  };
}

/** C# helper compiled in-process by PowerShell Add-Type. Nexus-authored. */
export const WINDOWS_JOB_CSHARP = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class NexusExecSandbox {
  const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
  const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
  const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectExtendedLimitInformation = 9;
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint DISABLE_MAX_PRIVILEGE = 0x1;
  const uint TOKEN_DUPLICATE = 0x0002;
  const uint TOKEN_QUERY = 0x0008;
  const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
  const uint TOKEN_ADJUST_DEFAULT = 0x0080;
  const uint TOKEN_ADJUST_SESSIONID = 0x0100;
  const uint LOGON_WITH_PROFILE = 1;
  const uint STARTF_USESTDHANDLES = 0x00000100;

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

  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFO {
    public int cb;
    public IntPtr lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
    public uint dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public uint dwProcessId, dwThreadId;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessWithTokenW(IntPtr hToken, uint dwLogonFlags, string lpApplicationName, StringBuilder lpCommandLine, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateRestrictedToken(IntPtr ExistingTokenHandle, uint Flags, uint DisableSidCount, IntPtr SidsToDisable, uint DeletePrivilegeCount, IntPtr PrivilegesToDelete, uint RestrictedSidCount, IntPtr SidsToRestrict, out IntPtr NewTokenHandle);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr hThread);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetStdHandle(int nStdHandle);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();

  const int STD_INPUT_HANDLE = -10;
  const int STD_OUTPUT_HANDLE = -11;
  const int STD_ERROR_HANDLE = -12;

  public static int Run(string comspec, string command, string cwd, uint maxProcesses, ulong maxMemoryBytes) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
    try {
      var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (maxProcesses > 0) {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.ActiveProcessLimit = maxProcesses;
      }
      if (maxMemoryBytes > 0) {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        limits.JobMemoryLimit = new UIntPtr(maxMemoryBytes);
        limits.ProcessMemoryLimit = new UIntPtr(maxMemoryBytes);
      }
      int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
      IntPtr buf = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(limits, buf, false);
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buf, (uint)size)) {
          throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject");
        }
      } finally {
        Marshal.FreeHGlobal(buf);
      }

      string cmdLine = "\\"" + comspec + "\\" /d /s /c \\"" + command + "\\"";
      var si = MakeStartupInfo();
      PROCESS_INFORMATION pi;
      uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT;
      bool started = TryCreateRestricted(comspec, cmdLine, cwd, flags, out pi);
      if (!started) {
        var sb = new StringBuilder(cmdLine);
        if (!CreateProcess(null, sb, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, cwd, ref si, out pi)) {
          throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess");
        }
      }
      try {
        if (!AssignProcessToJobObject(job, pi.hProcess)) {
          throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject");
        }
        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code;
        if (!GetExitCodeProcess(pi.hProcess, out code)) return 1;
        return (int)code;
      } finally {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
      }
    } finally {
      CloseHandle(job);
    }
  }

  static bool TryCreateRestricted(string app, string cmdLine, string cwd, uint flags, out PROCESS_INFORMATION pi) {
    pi = new PROCESS_INFORMATION();
    IntPtr existing;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID, out existing)) {
      return false;
    }
    try {
      IntPtr restricted;
      if (!CreateRestrictedToken(existing, DISABLE_MAX_PRIVILEGE, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted)) {
        return false;
      }
      try {
        var si = MakeStartupInfo();
        var sb = new StringBuilder(cmdLine);
        return CreateProcessWithTokenW(restricted, LOGON_WITH_PROFILE, null, sb, flags, IntPtr.Zero, cwd, ref si, out pi);
      } finally {
        CloseHandle(restricted);
      }
    } finally {
      CloseHandle(existing);
    }
  }

  static STARTUPINFO MakeStartupInfo() {
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    return si;
  }
}
`;

export const WINDOWS_JOB_PS1 = `param()
$ErrorActionPreference = 'Stop'
$cs = $env:NEXUS_SANDBOX_CS_PATH
if (-not $cs -or -not (Test-Path $cs)) { Write-Error 'nexus-sandbox: missing C# helper'; exit 125 }
$code = Get-Content -Raw -LiteralPath $cs
$dllDir = Join-Path $env:TEMP 'nexus-exec-sandbox'
New-Item -ItemType Directory -Force -Path $dllDir | Out-Null
$dll = Join-Path $dllDir 'NexusExecSandbox-v2.dll'
if (-not (Test-Path $dll)) {
  Add-Type -TypeDefinition $code -Language CSharp -OutputAssembly $dll | Out-Null
}
Add-Type -Path $dll
$comspec = $env:ComSpec
if (-not $comspec) { $comspec = Join-Path $env:SystemRoot 'System32\\cmd.exe' }
$command = $env:NEXUS_SANDBOX_COMMAND
$maxProc = [uint32]($env:NEXUS_SANDBOX_MAX_PROCESSES)
$maxMem = [uint64]($env:NEXUS_SANDBOX_MAX_MEMORY)
$cwd = (Get-Location).Path
$exitCode = [NexusExecSandbox]::Run($comspec, $command, $cwd, $maxProc, $maxMem)
exit $exitCode
`;

export function createWindowsJobBackend(
  probeFn: () => SandboxCapability = probeWindowsJob,
): SandboxBackend {
  return {
    id: "windows-job",
    probe: probeFn,
    prepare(policy: SandboxPolicy, enabled: boolean): SandboxPrepared {
      const capability = probeFn();
      if (!enabled || !capability.available) {
        return {
          policy,
          report: reportFromCapability(enabled, capability),
          artifacts: [],
          extraEnv: {},
        };
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-winjob-"));
      const scriptPath = path.join(dir, "job_spawn.ps1");
      const csPath = path.join(dir, "NexusExecSandbox.cs");
      fs.writeFileSync(scriptPath, WINDOWS_JOB_PS1, "utf8");
      fs.writeFileSync(csPath, WINDOWS_JOB_CSHARP, "utf8");
      const powershell =
        findOnPath(["pwsh", "powershell"]) ??
        path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        );
      return {
        policy,
        report: reportFromCapability(enabled, capability, "partial"),
        artifacts: [scriptPath, csPath, dir],
        extraEnv: {
          NEXUS_SANDBOX_POWERSHELL: powershell,
          NEXUS_SANDBOX_HELPER: scriptPath,
          NEXUS_SANDBOX_CS_PATH: csPath,
          NEXUS_SANDBOX_MAX_PROCESSES: String(policy.maxProcesses),
          NEXUS_SANDBOX_MAX_MEMORY: String(policy.maxMemoryBytes),
        },
      };
    },
    spawn(prepared: SandboxPrepared, request: SandboxSpawnRequest): ChildProcess {
      const helper = prepared.extraEnv.NEXUS_SANDBOX_HELPER;
      const powershell = prepared.extraEnv.NEXUS_SANDBOX_POWERSHELL;
      if (!helper || !powershell) {
        return spawn(request.command, [], {
          shell: true,
          cwd: request.cwd,
          env: request.env,
          signal: request.signal,
        });
      }
      return spawn(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
        ],
        {
          shell: false,
          cwd: request.cwd,
          env: {
            ...request.env,
            ...prepared.extraEnv,
            NEXUS_SANDBOX_COMMAND: request.command,
          },
          signal: request.signal,
          windowsHide: true,
        },
      );
    },
    teardown(prepared: SandboxPrepared): void {
      for (const artifact of [...prepared.artifacts].reverse()) {
        try {
          const stat = fs.statSync(artifact);
          if (stat.isDirectory()) fs.rmSync(artifact, { recursive: true, force: true });
          else fs.unlinkSync(artifact);
        } catch {
          // best-effort; cached DLL in %TEMP%\\nexus-exec-sandbox is kept
        }
      }
    },
  };
}
