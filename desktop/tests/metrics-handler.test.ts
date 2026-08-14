/**
 * v1.16.0 Phase 2.3 (adoption item A2) -- the `metrics.inference` IPC handler.
 *
 * Asserts the handler reads the injected registry, returns a response that
 * validates against the strict wire schema, and bounds how many individual
 * records it ships per poll.
 */

import { describe, expect, it } from "vitest";

import {
  InferenceMetricsRegistry,
  type InferenceMetricRecord,
} from "../../core/observability/InferenceMetrics";
import { CodingSessionManager } from "../sidecar/src/coding/sessionManager";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";
import {
  MetricsInferenceResponse,
  type MetricsInferenceResponseT,
} from "../sidecar/src/protocol";

function rec(over: Partial<InferenceMetricRecord> = {}): InferenceMetricRecord {
  return {
    model: "gemma4:12b",
    adapter: "ollama",
    promptTokens: 10,
    completionTokens: 20,
    tokenSource: "reported",
    ttftMs: 100,
    totalMs: 1000,
    tokensPerSec: 20,
    memoryBytes: 2048,
    at: 5_000,
    ...over,
  };
}

function ctxWith(metrics: InferenceMetricsRegistry) {
  return createHandlerContext(
    { pid: 1, platform: process.platform },
    new CodingSessionManager(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    metrics,
  );
}

async function call(metrics: InferenceMetricsRegistry): Promise<MetricsInferenceResponseT> {
  return (await dispatch("metrics.inference", {}, ctxWith(metrics))) as MetricsInferenceResponseT;
}

describe("metrics.inference", () => {
  it("returns empty collections when nothing has run", async () => {
    const reply = await call(new InferenceMetricsRegistry());
    expect(reply).toEqual({ perModel: [], recent: [] });
    expect(MetricsInferenceResponse.safeParse(reply).success).toBe(true);
  });

  it("returns a per-model rollup and the recent records", async () => {
    const registry = new InferenceMetricsRegistry();
    registry.record(rec({ model: "gemma4:12b", tokensPerSec: 10 }));
    registry.record(rec({ model: "gemma4:12b", tokensPerSec: 30 }));
    registry.record(rec({ model: "qwen3:8b", at: 9_000 }));

    const reply = await call(registry);
    expect(reply.perModel.map((m) => m.model)).toEqual(["qwen3:8b", "gemma4:12b"]);
    const gemma = reply.perModel.find((m) => m.model === "gemma4:12b");
    expect(gemma?.requestCount).toBe(2);
    expect(gemma?.avgTokensPerSec).toBe(20);
    expect(reply.recent).toHaveLength(3);
  });

  it("emits a response that validates against the strict wire schema", async () => {
    const registry = new InferenceMetricsRegistry();
    registry.record(rec());
    registry.record(rec({ promptTokens: null, completionTokens: null, tokenSource: "unavailable", tokensPerSec: null, ttftMs: null, memoryBytes: null }));
    const parsed = MetricsInferenceResponse.safeParse(await call(registry));
    expect(parsed.success).toBe(true);
  });

  it("caps the number of individual records returned", async () => {
    const registry = new InferenceMetricsRegistry();
    for (let i = 0; i < 120; i += 1) registry.record(rec({ at: i }));
    const reply = await call(registry);
    expect(reply.recent).toHaveLength(50);
    // Newest first.
    expect(reply.recent[0]?.at).toBe(119);
  });

  it("rejects unexpected params via the strict request schema", async () => {
    await expect(
      dispatch("metrics.inference", { nope: 1 }, ctxWith(new InferenceMetricsRegistry())),
    ).rejects.toThrow();
  });
});
