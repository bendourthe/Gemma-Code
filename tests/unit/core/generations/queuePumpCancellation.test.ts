import { afterEach, describe, expect, it } from "vitest";
import { GenerationIndex } from "../../../../core/generations/GenerationIndex";
import { GenerationQueue } from "../../../../core/generations/GenerationQueue";
import { pumpOnce } from "../../../../core/generations/queuePump";
import {
  GpuScheduler,
  type JobHandle,
} from "../../../../core/scheduler/GpuScheduler";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus";

describe("queue pump cancellation", () => {
  const queues: GenerationQueue[] = [];
  const indexes: GenerationIndex[] = [];

  afterEach(() => {
    for (const queue of queues.splice(0)) queue.close();
    for (const index of indexes.splice(0)) index.close();
  });

  it("keeps cancellation authoritative when a scheduled runner resolves late", async () => {
    const queue = new GenerationQueue({ dbPath: ":memory:" });
    const index = new GenerationIndex({ dbPath: ":memory:" });
    queues.push(queue);
    indexes.push(index);
    queue.enqueue({
      id: "enhance-child",
      pillar: "video",
      jobType: "enhance",
      parameters: {},
    });
    const scheduler = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 24,
    });
    let release!: () => void;
    let started!: () => void;
    const releaseRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let retained: JobHandle | null = null;
    let retainedReady!: () => void;
    const handleRetained = new Promise<void>((resolve) => {
      retainedReady = resolve;
    });
    let observedSignal: AbortSignal | null = null;
    const settled: string[] = [];
    const errors: string[] = [];

    const pumping = pumpOnce(queue, {
      scheduler,
      index,
      onHandle: (handle) => {
        retained = handle;
        retainedReady();
      },
      onHandleSettled: (_handle, job) => {
        settled.push(job.id);
      },
      onError: (event) => errors.push(event.message),
      run: async (_job, signal) => {
        observedSignal = signal;
        started();
        await releaseRun;
        return {
          bytes: Buffer.from("late-enhanced-output"),
          workflow: { kind: "enhancement" },
        };
      },
    });

    await Promise.all([runStarted, handleRetained]);
    expect(retained).not.toBeNull();
    queue.cancel("enhance-child");
    retained?.cancel();
    expect(observedSignal?.aborted).toBe(true);
    release();

    await expect(pumping).resolves.toMatchObject({
      id: "enhance-child",
      state: "failed",
      error: "cancelled",
    });
    expect(index.getByBytes(Buffer.from("late-enhanced-output"))).toBeNull();
    expect(errors).toEqual([]);
    expect(settled).toEqual(["enhance-child"]);
  });
});
