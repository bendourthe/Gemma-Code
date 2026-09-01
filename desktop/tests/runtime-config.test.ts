/**
 * v2.2.0 Phase 1 (1.3) -- installer-written runtime contract reader.
 *
 * The sidecar applies `~/.nexus/runtime.json` to the env knobs the diffusion
 * and models runtimes already honor. Explicit env always wins; a missing or
 * corrupt file is a silent no-op (dev checkouts have no runtime.json).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyRuntimeConfigEnv,
  readRuntimeConfig,
  runtimeConfigPath,
} from "../sidecar/src/runtimeConfig";

function tempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-runtime-config-"));
  const path = join(dir, "runtime.json");
  writeFileSync(path, content);
  return path;
}

describe("runtimeConfigPath", () => {
  it("resolves under <home>/.nexus/runtime.json", () => {
    expect(runtimeConfigPath("/home/u")).toBe(join("/home/u", ".nexus", "runtime.json"));
  });
});

describe("readRuntimeConfig", () => {
  it("returns null for a missing file", () => {
    expect(readRuntimeConfig(join(tmpdir(), "definitely-absent", "runtime.json"))).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    expect(readRuntimeConfig(tempConfig("{not json"))).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(readRuntimeConfig(tempConfig('["array"]'))).toBeNull();
  });

  it("parses a valid contract", () => {
    const path = tempConfig(
      JSON.stringify({
        schemaVersion: 1,
        nodePath: "C:/node/node.exe",
        diffusionPython: "C:/venv/python.exe",
        diffusionCwd: "C:/runtimes",
        modelsRoot: "C:/models",
      }),
    );
    const cfg = readRuntimeConfig(path);
    expect(cfg?.diffusionPython).toBe("C:/venv/python.exe");
    expect(cfg?.modelsRoot).toBe("C:/models");
  });
});

describe("applyRuntimeConfigEnv", () => {
  it("applies unset knobs and reports them", () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = applyRuntimeConfigEnv(env, {
      diffusionPython: "/venv/bin/python",
      diffusionCwd: "/opt/runtimes",
      modelsRoot: "/data/models",
    });
    expect(applied.sort()).toEqual([
      "NEXUS_DIFFUSION_CWD",
      "NEXUS_DIFFUSION_PYTHON",
      "NEXUS_MODELS_ROOT",
    ]);
    expect(env.NEXUS_DIFFUSION_PYTHON).toBe("/venv/bin/python");
    expect(env.NEXUS_MODELS_ROOT).toBe("/data/models");
  });

  it("never overrides explicit env values", () => {
    const env: NodeJS.ProcessEnv = { NEXUS_DIFFUSION_PYTHON: "explicit" };
    const applied = applyRuntimeConfigEnv(env, {
      diffusionPython: "/venv/bin/python",
    });
    expect(applied).toEqual([]);
    expect(env.NEXUS_DIFFUSION_PYTHON).toBe("explicit");
  });

  it("skips null and empty values", () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = applyRuntimeConfigEnv(env, {
      diffusionPython: null,
      diffusionCwd: "",
      modelsRoot: undefined,
    });
    expect(applied).toEqual([]);
  });

  it("is a no-op for a null config", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(applyRuntimeConfigEnv(env, null)).toEqual([]);
  });

  it("applies schema-v2 diffusion paths only after a successful smoke", () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = applyRuntimeConfigEnv(env, {
      schemaVersion: 2,
      diffusionPython: "/venv/bin/python",
      diffusionCwd: "/opt/runtimes",
      diffusion: {
        status: "ready",
        backend: "cuda",
        cuda_available: true,
        smoke_at: "2026-08-29T00:00:00Z",
        manifest_fingerprint: "abc123",
      },
    });
    expect(applied.sort()).toEqual([
      "NEXUS_DIFFUSION_CWD",
      "NEXUS_DIFFUSION_PYTHON",
    ]);
  });

  it("fails closed when schema-v2 readiness is missing", () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = applyRuntimeConfigEnv(env, {
      schemaVersion: 2,
      diffusionPython: "/venv/bin/python",
      diffusion: { status: "failed", failure_code: "CUDA_UNAVAILABLE" },
    });
    expect(applied).toEqual(["NEXUS_DIFFUSION_NOT_READY"]);
    expect(env.NEXUS_DIFFUSION_PYTHON).toBeUndefined();
    expect(env.NEXUS_DIFFUSION_NOT_READY).toBe("CUDA_UNAVAILABLE");
  });
});
