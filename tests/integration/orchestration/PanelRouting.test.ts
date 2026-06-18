/**
 * v1.6.0 adoption-openrouter-fusion Phase 4 (OF011, closing OF007.P3.A).
 *
 * Drives the PanelExecutor through the REAL `GpuScheduler` (OF007) with the REAL
 * `ModelPinRegistry` (OF008) wired in as the concurrency backend, and asserts
 * the end-to-end F3->F4 contract:
 *   - a panel whose summed VRAM fits free VRAM has its candidates gathered
 *     CONCURRENTLY (two panelists resident at once);
 *   - a panel whose summed VRAM exceeds free VRAM degrades to SEQUENTIAL (never
 *     more than one panelist resident -> no OOM), still collecting every
 *     candidate and fusing them;
 *   - the panel's models are kept resident for the run and released after;
 *   - the opt-in `PanelRouter` escalates a reliability-flagged task to the
 *     scheduler-backed panel and fuses the result.
 *
 * Mock LLM panelists + a fake judge; no live model. The real FusionAgent path
 * is covered by tests/integration/orchestration/PanelFusion.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  PanelExecutor,
  type LLMClientFactory,
} from "../../../modules/coding/orchestration/PanelExecutor.js";
import { PanelRouter } from "../../../modules/coding/llm/PanelRouter.js";
import type {
  FusionResult,
  PanelCandidate,
  PanelJudge,
} from "../../../modules/coding/orchestration/FusionAgent.js";
import type {
  OllamaChatChunk,
  OllamaClient,
} from "../../../modules/coding/llm/types.js";
import { GpuScheduler } from "../../../core/scheduler/GpuScheduler.js";
import { ModelPinRegistry } from "../../../core/registry/ModelPinRegistry.js";
import { InProcessTelemetryBus } from "../../../core/telemetry/TelemetryBus.js";

interface ResidencyCtx {
  active: number;
  maxActive: number;
}

/** A panelist client whose stream tracks concurrency and records the keep-alive
 * value observed for its own model while it runs. */
function makeTrackingClient(
  modelId: string,
  ctx: ResidencyCtx,
  registry: ModelPinRegistry,
  observed: Map<string, number | string>,
  delayMs = 5,
): OllamaClient {
  async function* gen(): AsyncGenerator<OllamaChatChunk> {
    ctx.active += 1;
    ctx.maxActive = Math.max(ctx.maxActive, ctx.active);
    observed.set(modelId, registry.keepAliveFor(modelId));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield { message: { content: `answer-${modelId}`, role: "assistant" }, done: true };
    ctx.active -= 1;
  }
  return {
    checkHealth: vi.fn(async () => true),
    listModels: vi.fn(async () => []),
    streamChat: vi.fn(() => gen()),
  };
}

function makeFakeJudge(): PanelJudge {
  return {
    fuse: vi.fn(
      async (_task: string, candidates: readonly PanelCandidate[]): Promise<FusionResult> => ({
        fusedOutput: "## Fused answer\nok",
        schemaValid: true,
        judgeModel: "judge",
        fusedCandidateCount: candidates.filter((c) => c.ok).length,
      }),
    ),
  };
}

describe("PanelExecutor + GpuScheduler + ModelPinRegistry (integration, OF007.P3.A)", () => {
  it("gathers candidates concurrently when VRAM permits and keeps models resident", async () => {
    const ctx: ResidencyCtx = { active: 0, maxActive: 0 };
    const registry = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const observed = new Map<string, number | string>();
    const clients: Record<string, OllamaClient> = {
      "gemma4:e4b": makeTrackingClient("gemma4:e4b", ctx, registry, observed),
      "qwen2.5-coder:3b": makeTrackingClient("qwen2.5-coder:3b", ctx, registry, observed),
    };
    const factory: LLMClientFactory = (id) => clients[id]!;
    const scheduler = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 16,
    });

    const exec = new PanelExecutor({
      clientFactory: factory,
      judge: makeFakeJudge(),
      concurrency: { scheduler, keepAlive: registry, vramFor: () => 4 },
    });

    const result = await exec.run("solve X", ["gemma4:e4b", "qwen2.5-coder:3b"]);

    // Both panelists were resident at the same time (concurrent fan-out).
    expect(ctx.maxActive).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.candidates.map((c) => c.model)).toEqual([
      "gemma4:e4b",
      "qwen2.5-coder:3b",
    ]);
    expect(result.fusion.fusedCandidateCount).toBe(2);
    // Each model was held resident (-1) during the run...
    expect(observed.get("gemma4:e4b")).toBe(-1);
    expect(observed.get("qwen2.5-coder:3b")).toBe(-1);
    // ...and released after fusion.
    expect(registry.isHeldForPanel("gemma4:e4b")).toBe(false);
    expect(registry.keepAliveFor("gemma4:e4b")).toBe("5m");
  });

  it("degrades to sequential when summed VRAM does not fit, still fusing every candidate", async () => {
    const ctx: ResidencyCtx = { active: 0, maxActive: 0 };
    const registry = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const observed = new Map<string, number | string>();
    const ids = ["a", "b", "c"];
    const clients: Record<string, OllamaClient> = Object.fromEntries(
      ids.map((id) => [id, makeTrackingClient(id, ctx, registry, observed)]),
    );
    const factory: LLMClientFactory = (id) => clients[id]!;
    const scheduler = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 8, // 3 x 5GB = 15GB > 8GB free -> sequential
    });

    const exec = new PanelExecutor({
      clientFactory: factory,
      judge: makeFakeJudge(),
      concurrency: { scheduler, keepAlive: registry, vramFor: () => 5 },
    });

    const result = await exec.run("p", ids);

    // Never more than one panelist resident at a time -> no OOM.
    expect(ctx.maxActive).toBe(1);
    expect(result.succeeded).toBe(3);
    expect(result.dispatched).toEqual(["a", "b", "c"]);
    expect(result.fusion.fusedCandidateCount).toBe(3);
  });

  it("routes a reliability-flagged task to the scheduler-backed panel via PanelRouter", async () => {
    const ctx: ResidencyCtx = { active: 0, maxActive: 0 };
    const registry = new ModelPinRegistry({ envKeepAlive: () => undefined });
    const observed = new Map<string, number | string>();
    const clients: Record<string, OllamaClient> = {
      m1: makeTrackingClient("m1", ctx, registry, observed),
      m2: makeTrackingClient("m2", ctx, registry, observed),
    };
    const factory: LLMClientFactory = (id) => clients[id]!;
    const scheduler = new GpuScheduler({
      telemetry: new InProcessTelemetryBus(),
      vramProvider: () => 16,
    });
    const exec = new PanelExecutor({
      clientFactory: factory,
      judge: makeFakeJudge(),
      concurrency: { scheduler, keepAlive: registry, vramFor: () => 4 },
    });
    const router = new PanelRouter({ executor: exec, config: { enabled: true } });

    const routed = await router.route({
      task: "Hard task.",
      highReliability: true,
      singleModel: "big:model",
      panelSpec: ["m1", "m2"],
    });

    expect(routed.decision.kind).toBe("panel");
    expect(routed.run).not.toBeNull();
    expect(routed.run?.succeeded).toBe(2);
    expect(ctx.maxActive).toBe(2); // ran concurrently through the real scheduler
  });
});
