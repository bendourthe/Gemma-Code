/**
 * v1.6.0 adoption-openrouter-fusion Phase 3 (OF009) -- panel residency integration.
 *
 * Drives a panel through the real `GpuScheduler` (OF007) with the real
 * `ModelPinRegistry` (OF008) wired in as the keep-alive coordinator, and
 * asserts the F3 contract end-to-end:
 *   - a panel whose summed VRAM fits free VRAM runs its members concurrently;
 *   - a panel whose summed VRAM exceeds free VRAM degrades to sequential
 *     (never more than one member resident -> no OOM, no rejection);
 *   - the panel's models are kept resident (`keepAliveFor === -1`) for the
 *     run's duration and revert to the default after fusion;
 *   - a user's explicit pin survives a panel run untouched.
 *
 * Mock VRAM source; no live model. `envKeepAlive: () => undefined` makes the
 * post-release default deterministic regardless of the CI host's environment.
 */

import { describe, it, expect } from "vitest";
import {
  GpuScheduler,
  type PanelMemberJob,
} from "../../../core/scheduler/GpuScheduler.js";
import { ModelPinRegistry } from "../../../core/registry/ModelPinRegistry.js";
import { InProcessTelemetryBus } from "../../../core/telemetry/TelemetryBus.js";

interface PanelCtx {
  active: number;
  maxActive: number;
}

/**
 * A panel member that records the keep-alive value observed for its own model
 * at the moment it starts running (proving the hold is in place during the
 * fan-out) and tracks concurrency so the test can assert concurrent vs
 * sequential residency.
 */
function residencyMember(
  registry: ModelPinRegistry,
  modelId: string,
  estimatedVramGB: number,
  observed: Map<string, number | string>,
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
        observed.set(modelId, registry.keepAliveFor(modelId));
        setTimeout(() => {
          ctx.active -= 1;
          resolve(`done:${modelId}`);
        }, delayMs);
      }),
  };
}

describe("GpuScheduler + ModelPinRegistry panel residency (integration)", () => {
  it("runs a fitting panel concurrently and keeps its models resident for the run", async () => {
    const sched = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 16,
    });
    const registry = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const observed = new Map<string, number | string>();
    const ctx: PanelCtx = { active: 0, maxActive: 0 };

    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "foreground",
      keepAlive: registry,
      members: [
        residencyMember(registry, "gemma4:e4b", 4, observed, ctx),
        residencyMember(registry, "qwen2.5-coder:3b", 4, observed, ctx),
      ],
    });
    const outcome = await handle.completion;

    expect(outcome.mode).toBe("concurrent");
    expect(ctx.maxActive).toBe(2);
    // Each model was kept resident (-1) while it ran.
    expect(observed.get("gemma4:e4b")).toBe(-1);
    expect(observed.get("qwen2.5-coder:3b")).toBe(-1);
    // Released after fusion: reverts to the default keep-alive.
    expect(registry.keepAliveFor("gemma4:e4b")).toBe("5m");
    expect(registry.isHeldForPanel("gemma4:e4b")).toBe(false);
    expect(registry.isHeldForPanel("qwen2.5-coder:3b")).toBe(false);
  });

  it("degrades a too-large panel to sequential without OOM and still keeps each member resident", async () => {
    const sched = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 8,
    });
    const registry = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const observed = new Map<string, number | string>();
    const ctx: PanelCtx = { active: 0, maxActive: 0 };

    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      keepAlive: registry,
      members: [
        residencyMember(registry, "a", 5, observed, ctx),
        residencyMember(registry, "b", 5, observed, ctx),
        residencyMember(registry, "c", 5, observed, ctx),
      ],
    });
    const outcome = await handle.completion;

    expect(outcome.mode).toBe("sequential");
    expect(ctx.maxActive).toBe(1); // never more than one resident -> no OOM
    expect(outcome.reservedVramGB).toBe(5);
    expect(observed.get("a")).toBe(-1);
    expect(observed.get("b")).toBe(-1);
    expect(observed.get("c")).toBe(-1);
    // All released after the run.
    expect(registry.keepAliveFor("a")).toBe("5m");
    expect(registry.isHeldForPanel("a")).toBe(false);
  });

  it("preserves a user's explicit pin across a panel run", async () => {
    const sched = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 16,
    });
    const registry = new ModelPinRegistry({ envKeepAlive: () => undefined });
    registry.pin("gemma4:e4b");

    const handle = await sched.enqueuePanel({
      moduleId: "coding",
      jobType: "fusion-panel",
      priority: "background",
      keepAlive: registry,
      members: [
        { modelId: "gemma4:e4b", estimatedVramGB: 4, run: () => Promise.resolve("x") },
        { modelId: "other:3b", estimatedVramGB: 4, run: () => Promise.resolve("y") },
      ],
    });
    await handle.completion;

    expect(registry.isPinned("gemma4:e4b")).toBe(true);
    expect(registry.keepAliveFor("gemma4:e4b")).toBe(-1); // still pinned
    expect(registry.isHeldForPanel("other:3b")).toBe(false); // transient hold released
    expect(registry.keepAliveFor("other:3b")).toBe("5m");
  });
});
