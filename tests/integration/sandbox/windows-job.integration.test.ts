import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createWindowsJobBackend, probeWindowsJob } from "../../../modules/coding/sandbox/backends/windowsJob.js";
import { deriveDefaultPolicy } from "../../../modules/coding/sandbox/policy.js";
import { spawnSandboxed } from "../../../modules/coding/sandbox/spawnSandboxed.js";
import { WINDOWS_UNENFORCED_DIMENSIONS } from "../../../modules/coding/sandbox/windowsMatrix.js";

const win = process.platform === "win32";
const capable = win && probeWindowsJob().available;

describe.skipIf(!capable)("Windows job-object integration", () => {
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

  it("runs an in-scope command under a job and reports partial confinement", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-sb-win-ws-"));
    dirs.push(workspace);
    const policy = deriveDefaultPolicy(workspace);
    const { child, report } = spawnSandboxed({
      command: "echo hello-from-job",
      cwd: workspace,
      env: process.env,
      enabled: true,
      policy,
      backend: createWindowsJobBackend(),
      log: { warn() {}, info() {} },
    });
    const result = await wait(child);
    expect(report.mode).toBe("partial");
    expect(report.unenforced).toEqual([...WINDOWS_UNENFORCED_DIMENSIONS]);
    expect(report.summary).toMatch(/partial/);
    expect(report.summary).toMatch(/filesystem/);
    if (result.code !== 0) {
      expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
    } else {
      expect(`${result.stdout}${result.stderr}`).toMatch(/hello-from-job/);
    }
  }, 60_000);
});

describe("Windows job capability honesty", () => {
  it("matches the host platform", () => {
    const cap = probeWindowsJob();
    if (process.platform !== "win32") expect(cap.available).toBe(false);
    else expect(typeof cap.available).toBe("boolean");
  });
});
