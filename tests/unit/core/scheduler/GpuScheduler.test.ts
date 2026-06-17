import { describe, it, expect, beforeEach } from "vitest";
import {
  GpuScheduler,
  InsufficientVramError,
  JobCancelledError,
  DEFAULT_PANEL_SIZE_CAP,
  type GpuJob,
  type PanelMemberJob,
  type PanelKeepAliveCoordinator,
} from "../../../../core/scheduler/GpuScheduler.js";
import {
  InProcessTelemetryBus,
  type TelemetryEvent,
} from "../../../../core/telemetry/TelemetryBus.js";

interface Recorded extends TelemetryEvent {
  payload: Record<string, unknown> | undefined;
}

function makeBusAndRecorder(): { bus: InProcessTelemetryBus; events: Recorded[] } {
  const bus = new InProcessTelemetryBus();
  const events: Recorded[] = [];
  bus.subscribe({}, (e) => events.push(e as Recorded));
  return { bus, events };
}

function makeJob(
  override: Partial<GpuJob> & { moduleId: GpuJob["moduleId"]; jobType: string },
): GpuJob {
  return {
    moduleId: override.moduleId,
    jobType: override.jobType,
    estimatedVramGB: override.estimatedVramGB ?? 1,
    priority: override.priority ?? "background",
    modelId: override.modelId,
    id: override.id,
    run:
      override.run ??
      ((_signal: AbortSignal) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(`done:${override.jobType}`), 5);
        })),
  };
}

describe("GpuScheduler", () => {
  let bus: InProcessTelemetryBus;
  let events: Recorded[];
  beforeEach(() => {
    ({ bus, events } = makeBusAndRecorder());
  });

  it("rejects a job whose estimatedVramGB exceeds free VRAM", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 4 });
    await expect(
      sched.enqueue(makeJob({ moduleId: "image", jobType: "txt2img", estimatedVramGB: 10 })),
    ).rejects.toBeInstanceOf(InsufficientVramError);
    const failed = events.find((e) => e.kind === "job.failed");
    expect(failed).toBeDefined();
    expect((failed?.payload as Record<string, unknown>)?.reason).toBe(
      "insufficient-vram",
    );
  });

  it("supports a vramProvider returning a promise", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => Promise.resolve(12) });
    const handle = await sched.enqueue(
      makeJob({ moduleId: "image", jobType: "txt2img", estimatedVramGB: 8 }),
    );
    await expect(handle.completion).resolves.toBe("done:txt2img");
  });

  it("serializes jobs FIFO (single-GPU ceiling)", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const order: string[] = [];
    const handles = await Promise.all([
      sched.enqueue(
        makeJob({
          moduleId: "coding",
          jobType: "tokens",
          estimatedVramGB: 1,
          run: () =>
            new Promise((r) => setTimeout(() => {
              order.push("coding");
              r("a");
            }, 10)),
        }),
      ),
      sched.enqueue(
        makeJob({
          moduleId: "image",
          jobType: "txt2img",
          estimatedVramGB: 1,
          run: () =>
            new Promise((r) => setTimeout(() => {
              order.push("image");
              r("b");
            }, 5)),
        }),
      ),
      sched.enqueue(
        makeJob({
          moduleId: "video",
          jobType: "text2video",
          estimatedVramGB: 1,
          run: () =>
            new Promise((r) => setTimeout(() => {
              order.push("video");
              r("c");
            }, 1)),
        }),
      ),
    ]);
    await Promise.all(handles.map((h) => h.completion));
    expect(order).toEqual(["coding", "image", "video"]);
  });

  it("setForegroundModule bumps matching queued jobs to the head, preserving FIFO order", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let release1!: () => void;
    const blocker = new Promise<void>((r) => {
      release1 = r;
    });
    const order: string[] = [];

    // First job: blocks the queue so we can reorder later items.
    const h0 = await sched.enqueue(
      makeJob({
        moduleId: "coding",
        jobType: "tokens",
        estimatedVramGB: 1,
        run: () => blocker.then(() => {
          order.push("coding");
          return null;
        }),
      }),
    );

    await sched.enqueue(
      makeJob({
        moduleId: "image",
        jobType: "i1",
        estimatedVramGB: 1,
        run: () => Promise.resolve().then(() => order.push("i1")),
      }),
    );
    await sched.enqueue(
      makeJob({
        moduleId: "video",
        jobType: "v1",
        estimatedVramGB: 1,
        run: () => Promise.resolve().then(() => order.push("v1")),
      }),
    );
    await sched.enqueue(
      makeJob({
        moduleId: "image",
        jobType: "i2",
        estimatedVramGB: 1,
        run: () => Promise.resolve().then(() => order.push("i2")),
      }),
    );

    sched.setForegroundModule("image");
    // Snapshot order should be image, image, video.
    const snap = sched.snapshot();
    expect(snap.queued.map((q) => q.jobType)).toEqual(["i1", "i2", "v1"]);

    release1();
    await h0.completion;
    // Wait for the queue to drain.
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["coding", "i1", "i2", "v1"]);
  });

  it("foreground-priority enqueue is auto-bumped to the head", async () => {
    const sched = new GpuScheduler({
      telemetry: bus,
      vramProvider: () => 16,
      foregroundModule: "image",
    });
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const h0 = await sched.enqueue(
      makeJob({
        moduleId: "coding",
        jobType: "tokens",
        estimatedVramGB: 1,
        run: () => blocker,
      }),
    );

    await sched.enqueue(
      makeJob({ moduleId: "video", jobType: "v1", estimatedVramGB: 1 }),
    );
    await sched.enqueue(
      makeJob({ moduleId: "image", jobType: "i1", estimatedVramGB: 1 }),
    );

    const queued = sched.snapshot().queued;
    expect(queued.map((q) => q.jobType)).toEqual(["i1", "v1"]);

    release();
    await h0.completion;
  });

  it("publishes job.queued / started / completed events in order", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const h = await sched.enqueue(
      makeJob({ moduleId: "chat", jobType: "stream", estimatedVramGB: 1 }),
    );
    await h.completion;
    const seq = events
      .filter((e) => e.source === "gpu-scheduler")
      .map((e) => e.kind);
    expect(seq[0]).toBe("job.queued");
    expect(seq[1]).toBe("job.started");
    expect(seq[2]).toBe("job.completed");
  });

  it("cancel() on a queued job drops it and rejects with JobCancelledError", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const h0 = await sched.enqueue(
      makeJob({ moduleId: "coding", jobType: "tokens", estimatedVramGB: 1, run: () => blocker }),
    );
    const h1 = await sched.enqueue(
      makeJob({ moduleId: "image", jobType: "t2i", estimatedVramGB: 1 }),
    );

    h1.cancel();
    await expect(h1.completion).rejects.toBeInstanceOf(JobCancelledError);
    expect(h1.state()).toBe("cancelled");
    release();
    await h0.completion;
  });

  it("cancel() on an active job aborts its signal and rejects", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let sawAbort = false;
    const h = await sched.enqueue(
      makeJob({
        moduleId: "image",
        jobType: "long",
        estimatedVramGB: 1,
        run: (signal) =>
          new Promise((_resolve, reject) => {
            const onAbort = (): void => {
              sawAbort = true;
              reject(new Error("aborted"));
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          }),
      }),
    );
    // Allow the run() to start.
    await new Promise((r) => setTimeout(r, 5));
    h.cancel();
    await expect(h.completion).rejects.toBeInstanceOf(JobCancelledError);
    expect(sawAbort).toBe(true);
    expect(h.state()).toBe("cancelled");
  });

  it("a failing run() surfaces as job.failed and rejects the handle", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const h = await sched.enqueue(
      makeJob({
        moduleId: "video",
        jobType: "broken",
        estimatedVramGB: 1,
        run: () => Promise.reject(new Error("oom")),
      }),
    );
    await expect(h.completion).rejects.toThrow("oom");
    const failed = events.find(
      (e) => e.kind === "job.failed" && (e.payload as Record<string, unknown>).jobType === "broken",
    );
    expect(failed).toBeDefined();
    expect(h.state()).toBe("failed");
  });

  it("multiple modules contend without overlap (integration)", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let active = 0;
    let maxActive = 0;
    function track(): Promise<unknown> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) =>
        setTimeout(() => {
          active -= 1;
          resolve(null);
        }, 5),
      );
    }
    const handles = await Promise.all([
      sched.enqueue(makeJob({ moduleId: "coding", jobType: "tokens", estimatedVramGB: 1, run: track })),
      sched.enqueue(makeJob({ moduleId: "image", jobType: "txt2img", estimatedVramGB: 1, run: track })),
      sched.enqueue(makeJob({ moduleId: "video", jobType: "text2video", estimatedVramGB: 1, run: track })),
    ]);
    await Promise.all(handles.map((h) => h.completion));
    expect(maxActive).toBe(1);
  });

  it("snapshot() reflects the active job and queued depth", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const h0 = await sched.enqueue(
      makeJob({
        moduleId: "coding",
        jobType: "tokens",
        estimatedVramGB: 1,
        run: () => blocker,
      }),
    );
    await sched.enqueue(makeJob({ moduleId: "image", jobType: "i1", estimatedVramGB: 1 }));
    await new Promise((r) => setTimeout(r, 0));
    const snap = sched.snapshot();
    expect(snap.active?.jobType).toBe("tokens");
    expect(snap.queued).toHaveLength(1);
    expect(snap.queued[0]?.jobType).toBe("i1");
    release();
    await h0.completion;
  });

  it("uses an injected id generator when provided", async () => {
    let n = 0;
    const sched = new GpuScheduler({
      telemetry: bus,
      vramProvider: () => 16,
      idGenerator: () => `id-${++n}`,
    });
    const h = await sched.enqueue(
      makeJob({ moduleId: "chat", jobType: "stream", estimatedVramGB: 1 }),
    );
    expect(h.id).toBe("id-1");
  });

  it("honours a caller-supplied job id over the generator", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const h = await sched.enqueue(
      makeJob({ moduleId: "chat", jobType: "stream", estimatedVramGB: 1, id: "custom-1" }),
    );
    expect(h.id).toBe("custom-1");
  });

  it("setForegroundModule(null) is a no-op for queue order", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const h0 = await sched.enqueue(
      makeJob({ moduleId: "coding", jobType: "tokens", estimatedVramGB: 1, run: () => blocker }),
    );
    await sched.enqueue(makeJob({ moduleId: "image", jobType: "i1", estimatedVramGB: 1 }));
    await sched.enqueue(makeJob({ moduleId: "video", jobType: "v1", estimatedVramGB: 1 }));
    sched.setForegroundModule(null);
    expect(sched.snapshot().queued.map((q) => q.jobType)).toEqual(["i1", "v1"]);
    release();
    await h0.completion;
  });

  it("foregroundModule getter exposes the last set value", () => {
    const sched = new GpuScheduler({
      telemetry: bus,
      vramProvider: () => 16,
      foregroundModule: "coding",
    });
    expect(sched.foregroundModule).toBe("coding");
    sched.setForegroundModule("video");
    expect(sched.foregroundModule).toBe("video");
  });

  it("cancel() on an already-cancelled job is a no-op", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const h0 = await sched.enqueue(
      makeJob({ moduleId: "coding", jobType: "tokens", estimatedVramGB: 1, run: () => blocker }),
    );
    const h1 = await sched.enqueue(
      makeJob({ moduleId: "image", jobType: "t2i", estimatedVramGB: 1 }),
    );
    h1.cancel();
    h1.cancel(); // second cancel must not throw
    await expect(h1.completion).rejects.toBeInstanceOf(JobCancelledError);
    release();
    await h0.completion;
  });
});

// ---------------------------------------------------------------------------
// Panel co-residency (v1.6.0 adoption-openrouter-fusion Phase 3, OF007 / OF009)
// ---------------------------------------------------------------------------

interface PanelCtx {
  active: number;
  maxActive: number;
  order: string[];
}

/** A panel member that tracks concurrency and records its dispatch order. */
function trackingMember(
  modelId: string,
  estimatedVramGB: number,
  ctx: PanelCtx,
  delayMs = 5,
): PanelMemberJob {
  return {
    modelId,
    estimatedVramGB,
    run: () =>
      new Promise((resolve) => {
        ctx.active += 1;
        ctx.maxActive = Math.max(ctx.maxActive, ctx.active);
        setTimeout(() => {
          ctx.active -= 1;
          ctx.order.push(modelId);
          resolve(`done:${modelId}`);
        }, delayMs);
      }),
  };
}

describe("GpuScheduler panel co-residency (OF007)", () => {
  let bus: InProcessTelemetryBus;
  let events: Recorded[];
  beforeEach(() => {
    ({ bus, events } = makeBusAndRecorder());
  });

  it("runs the panel concurrently when summed VRAM fits free VRAM", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const ctx: PanelCtx = { active: 0, maxActive: 0, order: [] };
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "foreground",
      members: [
        trackingMember("m1", 2, ctx),
        trackingMember("m2", 2, ctx),
        trackingMember("m3", 2, ctx),
      ],
    });
    const outcome = await handle.completion;
    expect(outcome.mode).toBe("concurrent");
    expect(ctx.maxActive).toBe(3);
    expect(outcome.admitted).toEqual(["m1", "m2", "m3"]);
    expect(outcome.reservedVramGB).toBe(6);
    expect(outcome.freeVramGB).toBe(16);
    expect(outcome.results.every((r) => r.ok)).toBe(true);
  });

  it("degrades to sequential (no OOM, no rejection) when summed VRAM exceeds free VRAM", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 8 });
    const ctx: PanelCtx = { active: 0, maxActive: 0, order: [] };
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      members: [
        trackingMember("m1", 5, ctx),
        trackingMember("m2", 5, ctx),
        trackingMember("m3", 5, ctx),
      ],
    });
    const outcome = await handle.completion;
    expect(outcome.mode).toBe("sequential");
    // Never more than one member resident at a time -> no OOM.
    expect(ctx.maxActive).toBe(1);
    // Peak reservation is the largest single member, never the sum.
    expect(outcome.reservedVramGB).toBe(5);
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results.every((r) => r.ok)).toBe(true);
    expect(ctx.order).toEqual(["m1", "m2", "m3"]);
  });

  it("enforces an explicit panel-size cap, dropping members beyond it", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 64 });
    const ctx: PanelCtx = { active: 0, maxActive: 0, order: [] };
    const members: PanelMemberJob[] = ["a", "b", "c", "d", "e"].map((id) =>
      trackingMember(id, 1, ctx),
    );
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      maxPanelSize: 2,
      members,
    });
    const outcome = await handle.completion;
    expect(outcome.admitted).toEqual(["a", "b"]);
    expect(outcome.droppedByCap).toEqual(["c", "d", "e"]);
    expect(outcome.results).toHaveLength(2);
  });

  it("defaults the panel-size cap to DEFAULT_PANEL_SIZE_CAP (3)", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 64 });
    const ctx: PanelCtx = { active: 0, maxActive: 0, order: [] };
    const members = ["a", "b", "c", "d"].map((id) => trackingMember(id, 1, ctx));
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      members,
    });
    const outcome = await handle.completion;
    expect(DEFAULT_PANEL_SIZE_CAP).toBe(3);
    expect(outcome.admitted).toHaveLength(3);
    expect(outcome.droppedByCap).toEqual(["d"]);
  });

  it("survives a single member throwing; survivors still produce results", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      members: [
        { modelId: "ok1", estimatedVramGB: 2, run: () => Promise.resolve("a1") },
        {
          modelId: "boom",
          estimatedVramGB: 2,
          run: () => Promise.reject(new Error("model crashed")),
        },
        { modelId: "ok2", estimatedVramGB: 2, run: () => Promise.resolve("a2") },
      ],
    });
    const outcome = await handle.completion;
    expect(outcome.results).toHaveLength(3);
    const boom = outcome.results.find((r) => r.modelId === "boom");
    expect(boom?.ok).toBe(false);
    expect(boom?.error).toContain("model crashed");
    expect(outcome.results.filter((r) => r.ok)).toHaveLength(2);
  });

  it("rejects a panel with no members", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    await expect(
      sched.enqueuePanel({
        moduleId: "coding",
        jobType: "fusion-panel",
        priority: "background",
        members: [],
      }),
    ).rejects.toThrow(/no members/);
  });

  it("publishes a panel.scheduled telemetry event carrying the mode and size", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      members: [
        { modelId: "m1", estimatedVramGB: 2, run: () => Promise.resolve("x") },
        { modelId: "m2", estimatedVramGB: 2, run: () => Promise.resolve("y") },
      ],
    });
    await handle.completion;
    const scheduled = events.find(
      (e) => (e.payload as Record<string, unknown>)?.panelEvent === "panel.scheduled",
    );
    expect(scheduled).toBeDefined();
    const payload = scheduled?.payload as Record<string, unknown>;
    expect(payload.panelMode).toBe("concurrent");
    expect(payload.panelSize).toBe(2);
    expect(payload.reservedVramGB).toBe(4);
  });

  it("preserves the single-active-job ceiling: a regular job waits for the panel", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const ctx: PanelCtx = { active: 0, maxActive: 0, order: [] };
    const panelHandle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      members: [trackingMember("m1", 2, ctx, 10), trackingMember("m2", 2, ctx, 10)],
    });
    const jobHandle = await sched.enqueue(
      makeJob({
        moduleId: "image",
        jobType: "txt2img",
        estimatedVramGB: 2,
        run: () => Promise.resolve().then(() => ctx.order.push("regular")),
      }),
    );
    await Promise.all([panelHandle.completion, jobHandle.completion]);
    // The panel fully drains (both members) before the regular job runs.
    expect(ctx.order).toEqual(["m1", "m2", "regular"]);
  });

  it("invokes the keep-alive coordinator for the run's duration and releases after", async () => {
    const sched = new GpuScheduler({ telemetry: bus, vramProvider: () => 16 });
    const held = new Set<string>();
    const coordLog: string[] = [];
    const coordinator: PanelKeepAliveCoordinator = {
      holdForPanel: (models) => {
        for (const m of models) held.add(m);
        coordLog.push(`hold:${models.join(",")}`);
        return {
          release: (): void => {
            for (const m of models) held.delete(m);
            coordLog.push("release");
          },
        };
      },
    };
    let heldDuringRun = false;
    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      keepAlive: coordinator,
      members: [
        {
          modelId: "m1",
          estimatedVramGB: 2,
          run: () => {
            heldDuringRun = held.has("m1");
            return Promise.resolve("x");
          },
        },
      ],
    });
    await handle.completion;
    expect(heldDuringRun).toBe(true);
    expect(held.size).toBe(0); // released after the run
    expect(coordLog).toEqual(["hold:m1", "release"]);
  });
});
