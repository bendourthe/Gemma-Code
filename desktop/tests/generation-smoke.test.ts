/**
 * v2.2.0 Phase 2 (2.5) -- generation smoke over the packaged stack shape.
 *
 * Proves the wiring an installed app depends on: an image/video request routes
 * through the handler layer to the diffusion runtime that `runtimeFactory`
 * selected from the installer's runtime contract, and that a MISSING runtime
 * fails as a typed `runtime-unavailable` instead of hanging or crashing.
 *
 * The real weights path (an actual SANA render on a GPU) is deliberately not
 * exercised here; it is the `NEXUS_LIVE_GPU=1` script and is recorded as a
 * known gap rather than faked with a green CI check.
 */

import { describe, expect, it } from "vitest";

import { createDiffusionRuntime } from "../sidecar/src/diffusion/runtimeFactory";
import { InMemoryDiffusionRuntime } from "../sidecar/src/diffusion/runtimeClient";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";

function contextWith(runtime: ReturnType<typeof createDiffusionRuntime>) {
  const ctx = createHandlerContext({ pid: process.pid, platform: process.platform });
  return { ...ctx, diffusion: runtime };
}

describe("generation smoke (mocked runtime)", () => {
  it("routes a txt2img request through to the diffusion runtime", async () => {
    const runtime = new InMemoryDiffusionRuntime();
    runtime.setResponse("txt2img", { jobId: "job-1", accepted: true });
    const ctx = contextWith(runtime as unknown as ReturnType<typeof createDiffusionRuntime>);

    const reply = (await dispatch(
      "diffusion.txt2img",
      {
        modelId: "sana-1.6b-2k",
        prompt: "a lighthouse at dusk",
        width: 1024,
        height: 1024,
        steps: 8,
        cfgScale: 4.5,
        seed: 42,
      },
      ctx,
    )) as Record<string, unknown>;

    expect(reply).toBeTruthy();
    // The handler layer accepted the job rather than throwing: the contract
    // the studios depend on.
    expect(JSON.stringify(reply)).toContain("job");
  });

  it("reports a missing diffusion python as runtime-unavailable, not a crash", async () => {
    // Exactly the installed-app failure mode: runtime.json points at a venv
    // that is not there (provisioning skipped or the venv was removed).
    const runtime = createDiffusionRuntime(
      { NEXUS_DIFFUSION_PYTHON: "C:/Nexus/python/venv/Scripts/python.exe" },
      { existsFn: () => false },
    );
    await expect(runtime.call("txt2img", { prompt: "x" })).rejects.toThrow(
      /^runtime-unavailable:/,
    );
    // And it names the remedy rather than only the symptom.
    await expect(runtime.call("txt2img", { prompt: "x" })).rejects.toThrow(/installer/);
  });

  it("selects the configured python from the installer runtime contract", () => {
    const spawned: string[] = [];
    const spawnFn = ((cmd: string) => {
      spawned.push(cmd);
      return {
        stdout: { on: () => undefined, setEncoding: () => undefined },
        stdin: { write: () => undefined, end: () => undefined },
        on: () => undefined,
        kill: () => undefined,
      };
    }) as unknown as Parameters<typeof createDiffusionRuntime>[1] extends undefined
      ? never
      : NonNullable<Parameters<typeof createDiffusionRuntime>[1]>["spawnFn"];

    const runtime = createDiffusionRuntime(
      {
        NEXUS_DIFFUSION_PYTHON: "C:/Nexus/python/venv/Scripts/python.exe",
        NEXUS_DIFFUSION_CWD: "C:/Nexus/runtimes",
      },
      { existsFn: () => true, spawnFn },
    );
    void runtime.call("health", {}).catch(() => undefined);
    expect(spawned[0]).toBe("C:/Nexus/python/venv/Scripts/python.exe");
    void runtime.shutdown();
  });
});
