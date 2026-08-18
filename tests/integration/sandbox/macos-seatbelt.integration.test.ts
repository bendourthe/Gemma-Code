import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { probeMacosSeatbelt } from "../../../modules/coding/sandbox/backends/macosSeatbelt.js";
import { deriveDefaultPolicy } from "../../../modules/coding/sandbox/policy.js";
import { spawnSandboxed } from "../../../modules/coding/sandbox/spawnSandboxed.js";
import { createMacosSeatbeltBackend } from "../../../modules/coding/sandbox/backends/macosSeatbelt.js";

const darwin = process.platform === "darwin";
const capable = darwin && probeMacosSeatbelt().available;

describe.skipIf(!capable)("macOS Seatbelt integration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function wait(
    child: { stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; once: Function },
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.once("close", (code: number | null) => resolve({ code, stdout, stderr }));
    });
  }

  it("allows an in-scope write and reports confined", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-mac-ws-"));
    dirs.push(workspace);
    const policy = deriveDefaultPolicy(workspace);
    const { child, report } = spawnSandboxed({
      command: "echo ok > inside.txt",
      cwd: workspace,
      env: process.env,
      enabled: true,
      policy,
      backend: createMacosSeatbeltBackend(),
      log: { warn() {}, info() {} },
    });
    const result = await wait(child);
    expect(report.mode).toBe("confined");
    expect(result.code).toBe(0);
    expect(readFileSync(path.join(workspace, "inside.txt"), "utf8")).toMatch(/ok/);
  });

  it("denies a write outside writable roots", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-mac-ws-"));
    const outside = mkdtempSync(path.join(os.homedir(), ".nexus-sb-mac-out-"));
    dirs.push(workspace, outside);
    const target = path.join(outside, "denied.txt");
    const policy = deriveDefaultPolicy(workspace, { tmpDir: workspace });
    const { child, report } = spawnSandboxed({
      command: `echo leaked > "${target}"`,
      cwd: workspace,
      env: process.env,
      enabled: true,
      policy,
      backend: createMacosSeatbeltBackend(),
      log: { warn() {}, info() {} },
    });
    const result = await wait(child);
    expect(report.mode).toBe("confined");
    expect(result.code).not.toBe(0);
    expect(() => readFileSync(target, "utf8")).toThrow();
  });
});

describe("macOS Seatbelt capability honesty", () => {
  it("matches the host platform", () => {
    const cap = probeMacosSeatbelt();
    if (process.platform !== "darwin") expect(cap.available).toBe(false);
    else expect(typeof cap.available).toBe("boolean");
  });
});
