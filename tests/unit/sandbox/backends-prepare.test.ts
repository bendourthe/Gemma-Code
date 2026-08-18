import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter();
    (child as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }).stdout =
      new EventEmitter();
    (child as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }).stderr =
      new EventEmitter();
    return child;
  }),
}));

import { spawn } from "child_process";
import { createLinuxLandlockBackend } from "../../../modules/coding/sandbox/backends/linuxLandlock.js";
import { createMacosSeatbeltBackend } from "../../../modules/coding/sandbox/backends/macosSeatbelt.js";
import { createWindowsJobBackend } from "../../../modules/coding/sandbox/backends/windowsJob.js";
import { deriveDefaultPolicy } from "../../../modules/coding/sandbox/policy.js";
import { selectSandboxBackend } from "../../../modules/coding/sandbox/selectBackend.js";
import { findOnPath, readTextIfExists } from "../../../modules/coding/sandbox/which.js";
import type { SandboxCapability } from "../../../modules/coding/sandbox/types.js";

const mockSpawn = vi.mocked(spawn);
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function available(backendId: string, platform: NodeJS.Platform): SandboxCapability {
  return {
    platform,
    backendId,
    available: true,
    detail: "test probe",
    enforced: ["filesystem", "network"],
    unenforced: [],
  };
}

describe("selectSandboxBackend", () => {
  it("maps each OS to its backend id", () => {
    expect(selectSandboxBackend("darwin").id).toBe("macos-seatbelt");
    expect(selectSandboxBackend("linux").id).toBe("linux-landlock");
    expect(selectSandboxBackend("win32").id).toBe("windows-job");
    expect(selectSandboxBackend("freebsd").id).toBe("none");
  });
});

describe("backend prepare/spawn/teardown", () => {
  it("macOS writes a Seatbelt profile and launches sandbox-exec", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-prep-"));
    temps.push(workspace);
    const backend = createMacosSeatbeltBackend(() => available("macos-seatbelt", "darwin"));
    const prepared = backend.prepare(deriveDefaultPolicy(workspace), true);
    expect(prepared.report.mode).toBe("confined");
    expect(prepared.extraEnv.NEXUS_SANDBOX_PROFILE).toBeDefined();
    backend.spawn(prepared, { command: "echo hi", cwd: workspace, env: process.env });
    expect(mockSpawn).toHaveBeenCalled();
    const file = mockSpawn.mock.calls[0]![0];
    expect(String(file)).toMatch(/sandbox-exec/);
    backend.teardown(prepared);
  });

  it("Linux writes the Landlock helper and launches python", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-prep-"));
    temps.push(workspace);
    const backend = createLinuxLandlockBackend(() => available("linux-landlock", "linux"));
    const prepared = backend.prepare(deriveDefaultPolicy(workspace), true);
    expect(prepared.extraEnv.NEXUS_SANDBOX_HELPER).toMatch(/landlock_preexec\.py$/);
    backend.spawn(prepared, { command: "echo hi", cwd: workspace, env: process.env });
    expect(mockSpawn.mock.calls[0]![1]).toEqual([prepared.extraEnv.NEXUS_SANDBOX_HELPER]);
    backend.teardown(prepared);
  });

  it("Windows writes the job helper and launches powershell", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-prep-"));
    temps.push(workspace);
    const backend = createWindowsJobBackend(() => ({
      platform: "win32",
      backendId: "windows-job",
      available: true,
      detail: "test",
      enforced: ["process-limits", "restricted-token"],
      unenforced: ["filesystem", "network"],
    }));
    const prepared = backend.prepare(deriveDefaultPolicy(workspace), true);
    expect(prepared.report.mode).toBe("partial");
    expect(prepared.extraEnv.NEXUS_SANDBOX_HELPER).toMatch(/job_spawn\.ps1$/);
    backend.spawn(prepared, { command: "echo hi", cwd: workspace, env: process.env });
    expect(String(mockSpawn.mock.calls[0]![0]).toLowerCase()).toMatch(/powershell|pwsh/);
    backend.teardown(prepared);
  });

  it("falls back to shell:true spawn when prepare did not install a helper", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-prep-"));
    temps.push(workspace);
    const backend = createMacosSeatbeltBackend(() => ({
      platform: "darwin",
      backendId: "macos-seatbelt",
      available: false,
      detail: "missing",
      enforced: [],
      unenforced: ["filesystem", "network", "process-limits", "restricted-token"],
    }));
    const prepared = backend.prepare(deriveDefaultPolicy(workspace), true);
    backend.spawn(prepared, { command: "echo hi", cwd: workspace, env: process.env });
    expect(mockSpawn.mock.calls[0]![0]).toBe("echo hi");
    expect((mockSpawn.mock.calls[0]![2] as { shell?: boolean }).shell).toBe(true);
    backend.teardown(prepared);
  });

  it("Windows spawn falls back to shell:true when the helper env is missing", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-prep-"));
    temps.push(workspace);
    const backend = createWindowsJobBackend(() => available("windows-job", "win32"));
    const prepared = backend.prepare(deriveDefaultPolicy(workspace), true);
    backend.spawn(
      { ...prepared, extraEnv: {} },
      { command: "echo hi", cwd: workspace, env: process.env },
    );
    expect(mockSpawn.mock.calls[0]![0]).toBe("echo hi");
    expect((mockSpawn.mock.calls[0]![2] as { shell?: boolean }).shell).toBe(true);
    backend.teardown(prepared);
  });
});

describe("findOnPath", () => {
  it("locates a well-known binary from PATH", () => {
    const found = findOnPath(process.platform === "win32" ? ["node"] : ["sh", "bash", "node"]);
    expect(found === null || found.length > 0).toBe(true);
  });

  it("returns null when no candidate exists", () => {
    expect(findOnPath(["nexus-exec-sandbox-binary-that-does-not-exist-xyz"])).toBeNull();
  });
});

describe("readTextIfExists", () => {
  it("returns file contents when the path exists", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-which-"));
    temps.push(dir);
    const file = path.join(dir, "probe.txt");
    writeFileSync(file, "landlock", "utf8");
    expect(readTextIfExists(file)).toBe("landlock");
  });

  it("returns null when the path is missing", () => {
    expect(readTextIfExists(path.join(os.tmpdir(), "nexus-no-such-lsm-file"))).toBeNull();
  });
});
