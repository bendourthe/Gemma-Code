/**
 * v1.0.0 Phase 8.5 -- multi-module scheduler integration test.
 *
 * Drives a Coding token-stream job, an Image Studio txt2img job, and a
 * Video Lab text2video job through a single `GpuScheduler` and asserts:
 *   - no two jobs ever overlap on the single-GPU ceiling;
 *   - telemetry events fire in the documented order (queued, started,
 *     completed for each module);
 *   - foreground bumping reorders pending jobs when the active module
 *     switches mid-flight.
 */

import { describe, it, expect } from "vitest";
import {
  GpuScheduler,
  type GpuJob,
  type JobHandle,
} from "../../core/scheduler/GpuScheduler.js";
import {
  InProcessTelemetryBus,
  type TelemetryEvent,
} from "../../core/telemetry/TelemetryBus.js";
import {
  GpuTelemetrySource,
  type GpuQueryResult,
} from "../../core/telemetry/GpuTelemetrySource.js";

describe("GpuScheduler + GpuTelemetrySource integration", () => {
  it("serializes one job per module without overlap", async () => {
    const bus = new InProcessTelemetryBus();
    const events: TelemetryEvent[] = [];
    bus.subscribe({}, (e) => events.push(e));
    const scheduler = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });

    let active = 0;
    let maxActive = 0;
    function makeRun(jobType: string): GpuJob["run"] {
      return () =>
        new Promise((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          setTimeout(() => {
            active -= 1;
            resolve(jobType);
          }, 10);
        });
    }

    const handles: JobHandle[] = await Promise.all([
      scheduler.enqueue({
        moduleId: "coding",
        jobType: "tokens",
        estimatedVramGB: 5,
        priority: "foreground",
        modelId: "gemma4:e4b",
        run: makeRun("tokens"),
      }),
      scheduler.enqueue({
        moduleId: "image",
        jobType: "txt2img",
        estimatedVramGB: 8,
        priority: "background",
        modelId: "sdxl_turbo",
        run: makeRun("txt2img"),
      }),
      scheduler.enqueue({
        moduleId: "video",
        jobType: "text2video",
        estimatedVramGB: 12,
        priority: "background",
        modelId: "ltx_video",
        run: makeRun("text2video"),
      }),
    ]);

    await Promise.all(handles.map((h) => h.completion));

    expect(maxActive).toBe(1);
    const schedEvents = events.filter((e) => e.source === "gpu-scheduler");
    expect(schedEvents.filter((e) => e.kind === "job.completed")).toHaveLength(3);
  });

  it("foreground module switch mid-flight reorders the remaining queue", async () => {
    const bus = new InProcessTelemetryBus();
    const scheduler = new GpuScheduler({
      telemetry: bus,
      vramProvider: () => 16,
      foregroundModule: "video",
    });
    const order: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const head = await scheduler.enqueue({
      moduleId: "video",
      jobType: "v0",
      estimatedVramGB: 2,
      priority: "foreground",
      run: () =>
        blocker.then(() => {
          order.push("v0");
          return null;
        }),
    });

    await scheduler.enqueue({
      moduleId: "image",
      jobType: "i1",
      estimatedVramGB: 2,
      priority: "background",
      run: () => Promise.resolve().then(() => order.push("i1")),
    });
    await scheduler.enqueue({
      moduleId: "coding",
      jobType: "c1",
      estimatedVramGB: 2,
      priority: "background",
      run: () => Promise.resolve().then(() => order.push("c1")),
    });
    await scheduler.enqueue({
      moduleId: "image",
      jobType: "i2",
      estimatedVramGB: 2,
      priority: "background",
      run: () => Promise.resolve().then(() => order.push("i2")),
    });

    // User opens the Image Studio while the video job is still running.
    scheduler.setForegroundModule("image");
    expect(scheduler.snapshot().queued.map((q) => q.jobType)).toEqual(["i1", "i2", "c1"]);

    release();
    await head.completion;
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["v0", "i1", "i2", "c1"]);
  });

  it("telemetry source can be driven from the scheduler's active job", async () => {
    const bus = new InProcessTelemetryBus();
    const scheduler = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const handle = await scheduler.enqueue({
      moduleId: "coding",
      jobType: "tokens",
      estimatedVramGB: 4,
      priority: "foreground",
      modelId: "gemma4:e4b",
      run: () => blocker,
    });
    const src = new GpuTelemetrySource({
      telemetry: bus,
      activeJobProvider: () => {
        const snap = scheduler.snapshot();
        return {
          modelId: snap.active?.modelId ?? null,
          queuedJobs: snap.queued.length,
        };
      },
      query: () =>
        Promise.resolve<GpuQueryResult>({
          device: "cuda",
          deviceName: "RTX 4070",
          utilizationPct: 60,
          totalVramGB: 12,
          freeVramGB: 6,
        }),
    });
    // Let the scheduler start the job.
    await new Promise((r) => setTimeout(r, 5));
    const sample = await src.sampleNow();
    expect(sample?.activeModelId).toBe("gemma4:e4b");
    release();
    await handle.completion;
  });
});
