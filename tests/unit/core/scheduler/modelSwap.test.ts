import { describe, it, expect } from "vitest";
import { evaluateModelSwap } from "../../../../core/scheduler/modelSwap.js";
import {
  GpuScheduler,
  type GpuJob,
} from "../../../../core/scheduler/GpuScheduler.js";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";

describe("evaluateModelSwap", () => {
  it("honors and keeps the worker when both fit", () => {
    const d = evaluateModelSwap({
      fromVramGB: 8,
      toVramGB: 10,
      freeVramGB: 12,
      workerResident: true,
    });
    expect(d.outcome).toBe("honored");
    expect(d.keepWorkerResident).toBe(true);
    expect(d.reason).toBe("both-fit-keep-worker");
  });

  it("honors and evicts the worker when they do not both fit", () => {
    const d = evaluateModelSwap({
      fromVramGB: 16,
      toVramGB: 20,
      freeVramGB: 8,
      workerResident: true,
    });
    expect(d.outcome).toBe("honored");
    expect(d.keepWorkerResident).toBe(false);
    expect(d.reason).toBe("evict-worker-for-strong");
  });

  it("defers when a diffusion job occupies VRAM that would OOM the swap", () => {
    const d = evaluateModelSwap({
      fromVramGB: 8,
      toVramGB: 20,
      freeVramGB: 4,
      diffusionActive: true,
      workerResident: true,
    });
    expect(d.outcome).toBe("deferred");
    expect(d.reason).toBe("diffusion-occupying-vram");
  });

  it("defers when VRAM telemetry is unavailable", () => {
    const d = evaluateModelSwap({
      fromVramGB: 8,
      toVramGB: 10,
      freeVramGB: null,
    });
    expect(d.outcome).toBe("deferred");
    expect(d.reason).toBe("vram-telemetry-unavailable");
  });

  it("defers when a resident worker plus free VRAM still cannot fit the strong model", () => {
    const d = evaluateModelSwap({
      fromVramGB: 4,
      toVramGB: 24,
      freeVramGB: 2,
      workerResident: true,
    });
    expect(d.outcome).toBe("deferred");
    expect(d.keepWorkerResident).toBe(true);
    expect(d.reason).toBe("insufficient-free-vram");
  });

  it("defers when the worker is gone and free VRAM cannot fit the target", () => {
    const d = evaluateModelSwap({
      fromVramGB: 8,
      toVramGB: 20,
      freeVramGB: 4,
      workerResident: false,
    });
    expect(d.outcome).toBe("deferred");
    expect(d.keepWorkerResident).toBe(false);
    expect(d.reason).toBe("insufficient-free-vram");
  });
});

describe("GpuScheduler.evaluateRoutingSwap", () => {
  function job(over: Partial<GpuJob> & { moduleId: GpuJob["moduleId"]; jobType: string }): GpuJob {
    return {
      estimatedVramGB: 1,
      priority: "background",
      run: () => new Promise(() => undefined),
      ...over,
    };
  }

  it("emits scheduler.swap and batches same-session requests", async () => {
    const bus = new InProcessTelemetryBus();
    const events: string[] = [];
    bus.subscribe({ kinds: ["scheduler.swap"] }, (e) => {
      events.push(String((e.payload as { batched?: boolean }).batched));
    });
    let now = 1000;
    const sched = new GpuScheduler({
      telemetry: bus,
      vramProvider: () => 24,
      now: () => now,
      swapBatchWindowMs: 50,
    });
    const a = sched.evaluateRoutingSwap({
      sessionId: "s",
      fromModelId: "w",
      toModelId: "s1",
      fromVramGB: 8,
      toVramGB: 10,
    });
    const b = sched.evaluateRoutingSwap({
      sessionId: "s",
      fromModelId: "w",
      toModelId: "s1",
      fromVramGB: 8,
      toVramGB: 10,
    });
    expect(a.outcome).toBe("honored");
    expect(b.outcome).toBe("honored");
    expect(events).toEqual(["false", "true"]);
    now = 2000;
    sched.evaluateRoutingSwap({
      sessionId: "s",
      fromModelId: "w",
      toModelId: "s1",
      fromVramGB: 8,
      toVramGB: 10,
    });
    expect(events).toHaveLength(3);
  });

  it("defers a swap while a diffusion job is the active occupant", async () => {
    const bus = new InProcessTelemetryBus();
    const sched = new GpuScheduler({
      telemetry: bus,
      vramProvider: () => 6,
      swapBatchWindowMs: 0,
    });
    await sched.enqueue(
      job({
        moduleId: "image",
        jobType: "txt2img",
        estimatedVramGB: 1,
        run: () => new Promise(() => undefined),
      }),
    );
    await new Promise((r) => setTimeout(r, 15));
    const d = sched.evaluateRoutingSwap({
      sessionId: "s",
      fromModelId: "w",
      toModelId: "strong",
      fromVramGB: 8,
      toVramGB: 20,
      workerResident: true,
    });
    expect(d.outcome).toBe("deferred");
    expect(d.reason).toBe("diffusion-occupying-vram");
  });
});
