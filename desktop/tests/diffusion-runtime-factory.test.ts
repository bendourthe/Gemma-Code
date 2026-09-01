/**
 * v1.7.0 -- the desktop Image Studio + Video Lab pillars now route to the real
 * Python diffusion runtime by default (ChildProcessDiffusionRuntime spawning
 * `python -m runtimes.diffusion.main`), falling back to the in-memory mock only
 * when NEXUS_DIFFUSION_INMEMORY is set. These tests cover the factory's
 * env-gated selection and that the real path spawns the configured command.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  createDiffusionRuntime,
  MediaRuntimeService,
  UnavailableDiffusionRuntime,
} from "../sidecar/src/diffusion/runtimeFactory";
import {
  ChildProcessDiffusionRuntime,
  InMemoryDiffusionRuntime,
} from "../sidecar/src/diffusion/runtimeClient";

function fakeSpawn() {
  const spawnFn = vi.fn(() => ({
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    on: vi.fn(),
    kill: vi.fn(),
  }));
  return spawnFn as unknown as NonNullable<Parameters<typeof createDiffusionRuntime>[1]>["spawnFn"];
}

describe("createDiffusionRuntime", () => {
  it("returns the in-memory mock when NEXUS_DIFFUSION_INMEMORY is set", () => {
    const rt = createDiffusionRuntime({ NEXUS_DIFFUSION_INMEMORY: "1" });
    expect(rt).toBeInstanceOf(InMemoryDiffusionRuntime);
  });

  it("returns the real child-process runtime by default", () => {
    const rt = createDiffusionRuntime({});
    expect(rt).toBeInstanceOf(ChildProcessDiffusionRuntime);
  });

  it("spawns the configured python runtime module on first call", async () => {
    const spawnFn = fakeSpawn();
    const rt = createDiffusionRuntime(
      { NEXUS_DIFFUSION_PYTHON: "python3" },
      { spawnFn },
    );
    // Triggers the lazy spawn; the fake child never replies, so swallow the
    // eventual rejection and shut down to clear the pending request.
    const pending = rt.call("health", {});
    pending.catch(() => undefined);
    expect(spawnFn).toHaveBeenCalledWith(
      "python3",
      ["-m", "runtimes.diffusion.main"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    await rt.shutdown();
  });

  // v2.2.0 Phase 1 (1.3): a configured absolute python path that is missing on
  // disk (venv renamed / provisioning skipped) yields the typed unavailable
  // runtime, never a silent bare-`python` fallback or a spawn crash.
  it("returns the typed unavailable runtime when the configured python path is missing", async () => {
    const rt = createDiffusionRuntime(
      { NEXUS_DIFFUSION_PYTHON: "C:/Nexus/python/venv/Scripts/python.exe" },
      { existsFn: () => false },
    );
    expect(rt).toBeInstanceOf(UnavailableDiffusionRuntime);
    await expect(rt.call("health", {})).rejects.toThrow(/^runtime-unavailable:/);
    expect(rt.drainEvents("any")).toEqual([]);
    await rt.shutdown();
  });

  it("keeps the real runtime when the configured python path exists", () => {
    const rt = createDiffusionRuntime(
      { NEXUS_DIFFUSION_PYTHON: "C:/venv/python.exe" },
      { existsFn: () => true, spawnFn: fakeSpawn() },
    );
    expect(rt).toBeInstanceOf(ChildProcessDiffusionRuntime);
  });

  it("does not path-check a bare PATH command name", () => {
    const rt = createDiffusionRuntime(
      { NEXUS_DIFFUSION_PYTHON: "python3" },
      { existsFn: () => false, spawnFn: fakeSpawn() },
    );
    expect(rt).toBeInstanceOf(ChildProcessDiffusionRuntime);
  });

  it("returns an actionable unavailable runtime for failed CUDA readiness", async () => {
    const rt = createDiffusionRuntime({
      NEXUS_DIFFUSION_NOT_READY: "CUDA_UNAVAILABLE",
    });
    expect(rt).toBeInstanceOf(UnavailableDiffusionRuntime);
    await expect(rt.call("health", {})).rejects.toThrow(
      /cannot access CUDA.*re-run the installer/i,
    );
  });
});

describe("MediaRuntimeService", () => {
  const config = {
    schemaVersion: 3,
    diffusionPython: "C:/Nexus/python.exe",
    diffusionCwd: "C:/Nexus/app",
    diffusion: {
      status: "failed",
      failure_code: "CUDA_UNAVAILABLE",
    },
  } as const;

  it("fails closed when the runtime contract is absent", () => {
    const service = new MediaRuntimeService({
      configPath: "C:/Users/test/.nexus/runtime.json",
      readConfig: () => null,
    });
    expect(service.status()).toMatchObject({
      state: "failed",
      code: "CONTRACT_MISSING",
      retryable: false,
    });
  });

  it("reports ready only when the installed executable paths exist", () => {
    const service = new MediaRuntimeService({
      readConfig: () => ({ ...config, diffusion: { status: "ready" } }),
      existsFn: () => true,
    });
    expect(service.status()).toMatchObject({ state: "ready", code: "READY", progress: 1 });
  });

  it("shares a live external repair instead of starting a duplicate", () => {
    const service = new MediaRuntimeService({
      readConfig: () => ({
        ...config,
        repairAttempt: { status: "repairing", ownerPid: 42 },
      }),
      existsFn: () => true,
      pidAliveFn: (pid) => pid === 42,
    });
    expect(service.status()).toMatchObject({
      state: "repairing",
      code: "REPAIR_BUSY",
      retryable: false,
    });
  });

  it("turns an interrupted repair into an actionable in-place retry", () => {
    const service = new MediaRuntimeService({
      readConfig: () => ({
        ...config,
        repairAttempt: { status: "repairing", ownerPid: 42 },
      }),
      existsFn: () => true,
      pidAliveFn: () => false,
    });
    expect(service.status()).toMatchObject({
      state: "repairable",
      code: "INTERRUPTED_REPAIR",
      retryable: true,
    });
  });
});
