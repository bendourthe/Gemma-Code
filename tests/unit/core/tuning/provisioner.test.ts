import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TuningProvisioner } from "../../../../core/tuning/provisioner.js";

describe("TuningProvisioner", () => {
  it("records unsupported hosts without calling pip", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-prov-"));
    const seen: string[][] = [];
    const p = new TuningProvisioner({
      root,
      host: { osFamily: "macos", gpuVendor: "apple", vramGB: 32 },
      runner: (argv) => {
        seen.push([...argv]);
        return { returncode: 0, stdout: "", stderr: "" };
      },
    });
    const state = await p.provision();
    expect(state.status).toBe("unsupported");
    expect(seen).toHaveLength(0);
  });

  it("installs pinned packages and refuses a studio extra", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-prov-"));
    const seen: string[][] = [];
    const p = new TuningProvisioner({
      root,
      host: { osFamily: "windows", gpuVendor: "nvidia", vramGB: 16 },
      runner: (argv) => {
        seen.push([...argv]);
        return { returncode: 0, stdout: "ok", stderr: "" };
      },
    });
    const state = await p.provision();
    expect(state.status).toBe("ready");
    expect(seen.some((argv) => argv.join(" ").includes("unsloth==2026.8.18"))).toBe(true);
    expect(seen.every((argv) => !argv.join(" ").toLowerCase().includes("[studio]"))).toBe(true);
  });

  it("preflight fails when the venv python is missing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-prov-"));
    const p = new TuningProvisioner({
      root,
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
    });
    const result = await p.preflight();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/missing/i);
  });

  it("preflight runs import unsloth when python exists", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-prov-"));
    const pyDir = process.platform === "win32"
      ? path.join(root, "venv", "Scripts")
      : path.join(root, "venv", "bin");
    mkdirSync(pyDir, { recursive: true });
    const py = path.join(pyDir, process.platform === "win32" ? "python.exe" : "python");
    writeFileSync(py, "");
    const p = new TuningProvisioner({
      root,
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
      runner: () => ({ returncode: 0, stdout: "ok", stderr: "" }),
    });
    expect((await p.preflight()).ok).toBe(true);
  });

  it("records a failed pip install and a missing-import preflight", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nexus-prov-"));
    const fail = new TuningProvisioner({
      root,
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
      runner: () => ({ returncode: 1, stdout: "", stderr: "network down" }),
    });
    const state = await fail.provision();
    expect(state.status).toBe("failed");
    expect(state.error).toMatch(/network/);

    writeFileSync(path.join(root, "provision.json"), "{not json");
    const corrupt = new TuningProvisioner({
      root,
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
    });
    expect(corrupt.state().status).toBe("failed");

    const pyDir = process.platform === "win32"
      ? path.join(root, "venv", "Scripts")
      : path.join(root, "venv", "bin");
    mkdirSync(pyDir, { recursive: true });
    writeFileSync(path.join(pyDir, process.platform === "win32" ? "python.exe" : "python"), "");
    const pf = new TuningProvisioner({
      root,
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
      runner: () => ({ returncode: 1, stdout: "", stderr: "import unsloth failed" }),
    });
    expect((await pf.preflight()).ok).toBe(false);
  });

  it("uses nexusHome when root is omitted", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "nexus-home-"));
    const p = new TuningProvisioner({
      host: { osFamily: "linux", gpuVendor: "nvidia", vramGB: 24 },
      homeDirFn: () => home,
      runner: () => ({ returncode: 0, stdout: "ok", stderr: "" }),
    });
    const state = await p.provision();
    expect(state.status).toBe("ready");
  });
});
