/**
 * v1.7.0 -- the desktop Image Studio + Video Lab pillars now route to the real
 * Python diffusion runtime by default (ChildProcessDiffusionRuntime spawning
 * `python -m runtimes.diffusion.main`), falling back to the in-memory mock only
 * when NEXUS_DIFFUSION_INMEMORY is set. These tests cover the factory's
 * env-gated selection and that the real path spawns the configured command.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createDiffusionRuntime } from "../sidecar/src/diffusion/runtimeFactory";
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
});
