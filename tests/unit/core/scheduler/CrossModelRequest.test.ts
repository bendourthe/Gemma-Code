/**
 * v2.2.0 Phase 4 (4.2) -- agentic cross-model requests.
 *
 * The defect these guard against is subtle: a task that generates an image
 * mid-run and then continues coding with the WRONG model resident, or with a
 * leaked keep-alive hold. Every exit path must restore.
 */

import { describe, expect, it, vi } from "vitest";

import {
  CrossModelDeferredError,
  ModelNotInstalledError,
  runCrossModelRequest,
  type CrossModelPorts,
  type CrossModelProgress,
} from "../../../../core/scheduler/CrossModelRequest";

const AGENTIC_MODEL = "qwen2.5-coder:14b";
const IMAGE_MODEL = "sana-1.6b-2k";

function makePorts(overrides: Partial<CrossModelPorts> = {}) {
  const released: string[][] = [];
  const held: string[][] = [];
  const progress: CrossModelProgress[] = [];
  const ports: CrossModelPorts = {
    readResidency: async () => ({
      resident: [{ modelId: AGENTIC_MODEL, vramGB: 9 }],
      freeVramGB: 1, // tight: forces a swap unless overridden
      activeJob: { moduleId: "coding", jobType: "agent-turn" },
    }),
    isInstalled: async () => true,
    vramFor: async () => 3.2,
    runJob: async (job) => job.run(),
    keepAlive: {
      holdForPanel: (models) => {
        held.push([...models]);
        return {
          release: () => {
            released.push([...models]);
          },
        };
      },
    },
    onProgress: (e) => progress.push(e),
    ...overrides,
  };
  return { ports, released, held, progress };
}

describe("runCrossModelRequest: happy path", () => {
  it("swaps, runs, and releases the agentic hold", async () => {
    const { ports, held, released, progress } = makePorts();
    const outcome = await runCrossModelRequest(
      {
        agenticModelId: AGENTIC_MODEL,
        targetModelId: IMAGE_MODEL,
        requestingModule: "image",
        jobType: "txt2img",
        run: async () => "an image",
      },
      ports,
    );

    expect(outcome.result).toBe("an image");
    expect(outcome.verdict.kind).toBe("auto-switch");
    // The agentic model is held for the whole step and released exactly once.
    expect(held).toEqual([[AGENTIC_MODEL]]);
    expect(released).toEqual([[AGENTIC_MODEL]]);
    expect(progress.map((p) => p.phase)).toEqual([
      "switching",
      "running",
      "done",
      "restoring",
    ]);
  });

  it("co-resides without a switch when both models fit", async () => {
    const { ports, progress } = makePorts({
      readResidency: async () => ({
        resident: [{ modelId: AGENTIC_MODEL, vramGB: 9 }],
        freeVramGB: 8,
        activeJob: { moduleId: "coding", jobType: "agent-turn" },
      }),
    });
    const outcome = await runCrossModelRequest(
      {
        agenticModelId: AGENTIC_MODEL,
        targetModelId: IMAGE_MODEL,
        requestingModule: "image",
        jobType: "txt2img",
        run: async () => "ok",
      },
      ports,
    );
    expect(outcome.verdict.kind).toBe("coreside");
    expect(outcome.coResided).toBe(true);
    expect(progress.some((p) => p.phase === "switching")).toBe(false);
  });

  it("routes the job through the scheduler with the target model's VRAM", async () => {
    const runJob = vi.fn(async (job: { run: () => Promise<unknown> }) => job.run());
    const { ports } = makePorts({ runJob: runJob as unknown as CrossModelPorts["runJob"] });
    await runCrossModelRequest(
      {
        agenticModelId: AGENTIC_MODEL,
        targetModelId: IMAGE_MODEL,
        requestingModule: "image",
        jobType: "txt2img",
        run: async () => "ok",
      },
      ports,
    );
    expect(runJob).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "image", modelId: IMAGE_MODEL, estimatedVramGB: 3.2 }),
    );
  });
});

describe("runCrossModelRequest: failure modes", () => {
  it("throws a typed not-installed error and enqueues nothing", async () => {
    const runJob = vi.fn();
    const { ports, held } = makePorts({
      isInstalled: async () => false,
      runJob: runJob as unknown as CrossModelPorts["runJob"],
    });
    await expect(
      runCrossModelRequest(
        {
          agenticModelId: AGENTIC_MODEL,
          targetModelId: "not-a-model",
          requestingModule: "image",
          jobType: "txt2img",
          run: async () => "never",
        },
        ports,
      ),
    ).rejects.toBeInstanceOf(ModelNotInstalledError);
    // No hold taken, no job queued: nothing to leak.
    expect(held).toEqual([]);
    expect(runJob).not.toHaveBeenCalled();
  });

  it("names the model in the not-installed message so the agent can report it", async () => {
    const { ports } = makePorts({ isInstalled: async () => false });
    await expect(
      runCrossModelRequest(
        {
          agenticModelId: AGENTIC_MODEL,
          targetModelId: "missing-model",
          requestingModule: "image",
          jobType: "txt2img",
          run: async () => "never",
        },
        ports,
      ),
    ).rejects.toThrow(/missing-model/);
  });

  it("defers instead of guessing when VRAM telemetry is unavailable", async () => {
    const { ports, held } = makePorts({
      readResidency: async () => ({
        resident: [{ modelId: AGENTIC_MODEL, vramGB: 9 }],
        freeVramGB: null,
        activeJob: null,
      }),
    });
    await expect(
      runCrossModelRequest(
        {
          agenticModelId: AGENTIC_MODEL,
          targetModelId: IMAGE_MODEL,
          requestingModule: "image",
          jobType: "txt2img",
          run: async () => "never",
        },
        ports,
      ),
    ).rejects.toBeInstanceOf(CrossModelDeferredError);
    expect(held).toEqual([]);
  });

  it("restores the agentic model when the job itself fails", async () => {
    const { ports, released, progress } = makePorts();
    await expect(
      runCrossModelRequest(
        {
          agenticModelId: AGENTIC_MODEL,
          targetModelId: IMAGE_MODEL,
          requestingModule: "image",
          jobType: "txt2img",
          run: async () => {
            throw new Error("diffusion runtime crashed");
          },
        },
        ports,
      ),
    ).rejects.toThrow(/diffusion runtime crashed/);
    // The whole point: residency is restored even on failure.
    expect(released).toEqual([[AGENTIC_MODEL]]);
    expect(progress.at(-1)).toMatchObject({ phase: "restoring", modelId: AGENTIC_MODEL });
  });

  it("restores the agentic model when the task is aborted mid-swap", async () => {
    const controller = new AbortController();
    const { ports, released } = makePorts({
      runJob: async (job) => {
        controller.abort();
        throw new Error("aborted");
      },
    });
    await expect(
      runCrossModelRequest(
        {
          agenticModelId: AGENTIC_MODEL,
          targetModelId: IMAGE_MODEL,
          requestingModule: "image",
          jobType: "txt2img",
          signal: controller.signal,
          run: async () => "never",
        },
        ports,
      ),
    ).rejects.toThrow(/aborted/);
    expect(released).toEqual([[AGENTIC_MODEL]]);
  });

  it("releases the hold exactly once even on failure", async () => {
    const { ports, released } = makePorts({
      runJob: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      runCrossModelRequest(
        {
          agenticModelId: AGENTIC_MODEL,
          targetModelId: IMAGE_MODEL,
          requestingModule: "image",
          jobType: "txt2img",
          run: async () => "never",
        },
        ports,
      ),
    ).rejects.toThrow();
    expect(released).toHaveLength(1);
  });
});
