// v1.16.0 Phase 2.3 (adoption item A2) -- per-model inference metrics.
//
// The load-bearing assertions here are the "missing is not zero" ones: a backend
// that reports no token counts must yield null and must not drag a per-model
// average toward zero.

import { describe, expect, it, vi } from "vitest";

import { InProcessTelemetryBus, type TelemetryEvent } from "../../../../core/telemetry/TelemetryBus.js";
import {
  DEFAULT_METRIC_CAPACITY,
  InferenceMetricsRegistry,
  type InferenceMetricRecord,
  createTelemetryMetricPublisher,
  deriveTokensPerSec,
  median,
  metricSpanAttributes,
  nsToMs,
  setSharedInferenceMetrics,
  sharedInferenceMetrics,
} from "../../../../core/observability/InferenceMetrics.js";

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
    memoryBytes: 1024,
    at: 1_000,
    ...over,
  };
}

describe("deriveTokensPerSec", () => {
  it("prefers the backend's generation duration over total wall time", () => {
    // 20 tokens in 500ms of generation = 40/s, even though wall time was 2s.
    expect(deriveTokensPerSec({ completionTokens: 20, evalDurationNs: 500_000_000, totalMs: 2000 })).toBe(40);
  });

  it("falls back to total wall time when the backend reports no eval duration", () => {
    expect(deriveTokensPerSec({ completionTokens: 20, totalMs: 2000 })).toBe(10);
  });

  it("returns null when token counts are unavailable", () => {
    expect(deriveTokensPerSec({ completionTokens: null, totalMs: 1000 })).toBeNull();
  });

  it("returns null for zero tokens rather than reporting 0/s", () => {
    expect(deriveTokensPerSec({ completionTokens: 0, totalMs: 1000 })).toBeNull();
  });

  it("returns null when no duration is usable", () => {
    expect(deriveTokensPerSec({ completionTokens: 20, totalMs: 0 })).toBeNull();
    expect(deriveTokensPerSec({ completionTokens: 20, evalDurationNs: 0, totalMs: null })).toBeNull();
  });
});

describe("nsToMs", () => {
  it("converts nanoseconds to milliseconds", () => {
    expect(nsToMs(1_500_000)).toBe(1.5);
  });

  it("preserves absent values", () => {
    expect(nsToMs(null)).toBeNull();
    expect(nsToMs(undefined)).toBeNull();
    expect(nsToMs(Number.NaN)).toBeNull();
  });
});

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("InferenceMetricsRegistry", () => {
  it("records and returns recent entries newest-first", () => {
    const registry = new InferenceMetricsRegistry();
    registry.record(rec({ at: 1 }));
    registry.record(rec({ at: 2 }));
    expect(registry.size).toBe(2);
    expect(registry.recent().map((r) => r.at)).toEqual([2, 1]);
  });

  it("honours the recent() limit and rejects a non-positive one", () => {
    const registry = new InferenceMetricsRegistry();
    for (let i = 0; i < 5; i += 1) registry.record(rec({ at: i }));
    expect(registry.recent(2)).toHaveLength(2);
    expect(registry.recent(0)).toEqual([]);
  });

  it("drops the oldest records past capacity", () => {
    const registry = new InferenceMetricsRegistry({ capacity: 3 });
    for (let i = 0; i < 5; i += 1) registry.record(rec({ at: i }));
    expect(registry.size).toBe(3);
    expect(registry.recent().map((r) => r.at)).toEqual([4, 3, 2]);
  });

  it("falls back to the default capacity for a non-positive option", () => {
    const registry = new InferenceMetricsRegistry({ capacity: 0 });
    for (let i = 0; i < DEFAULT_METRIC_CAPACITY + 10; i += 1) registry.record(rec({ at: i }));
    expect(registry.size).toBe(DEFAULT_METRIC_CAPACITY);
  });

  it("redacts a secret that appears in a model id", () => {
    const registry = new InferenceMetricsRegistry();
    registry.record(rec({ model: "ghp_0123456789abcdefghijklmnopqrstuvwxyz" }));
    expect(registry.recent()[0]?.model).not.toContain("0123456789abcdef");
  });

  it("never throws from record(), even on a hostile input", () => {
    const registry = new InferenceMetricsRegistry();
    expect(() =>
      registry.record(rec({ model: null as unknown as string })),
    ).not.toThrow();
  });

  it("clear() empties the buffer", () => {
    const registry = new InferenceMetricsRegistry();
    registry.record(rec());
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.perModel()).toEqual([]);
  });

  describe("perModel", () => {
    it("rolls up count, tokens, average rate, and median TTFT", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(rec({ tokensPerSec: 10, ttftMs: 100, promptTokens: 5, completionTokens: 5 }));
      registry.record(rec({ tokensPerSec: 30, ttftMs: 300, promptTokens: 5, completionTokens: 5 }));
      const [summary] = registry.perModel();
      expect(summary?.requestCount).toBe(2);
      expect(summary?.totalTokens).toBe(20);
      expect(summary?.avgTokensPerSec).toBe(20);
      expect(summary?.medianTtftMs).toBe(200);
    });

    it("separates models and sorts most-recently-used first", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(rec({ model: "old-model", at: 1 }));
      registry.record(rec({ model: "new-model", at: 5 }));
      expect(registry.perModel().map((m) => m.model)).toEqual(["new-model", "old-model"]);
    });

    it("excludes null rates from the average instead of counting them as zero", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(rec({ tokensPerSec: 40 }));
      registry.record(rec({ tokensPerSec: null, completionTokens: null, promptTokens: null }));
      // Average of the one real reading, NOT 40/2.
      expect(registry.perModel()[0]?.avgTokensPerSec).toBe(40);
    });

    it("reports null rate and null TTFT when nothing was measurable", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(
        rec({ tokensPerSec: null, ttftMs: null, promptTokens: null, completionTokens: null }),
      );
      const [summary] = registry.perModel();
      expect(summary?.avgTokensPerSec).toBeNull();
      expect(summary?.medianTtftMs).toBeNull();
      expect(summary?.totalTokens).toBe(0);
    });

    it("carries the most recent non-null memory reading", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(rec({ memoryBytes: 111, at: 1 }));
      registry.record(rec({ memoryBytes: 222, at: 2 }));
      registry.record(rec({ memoryBytes: null, at: 3 }));
      expect(registry.perModel()[0]?.lastMemoryBytes).toBe(222);
    });

    it("flags a model whose counts were not all backend-reported", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(rec({ tokenSource: "reported" }));
      expect(registry.perModel()[0]?.allCountsReported).toBe(true);
      registry.record(rec({ tokenSource: "estimated" }));
      expect(registry.perModel()[0]?.allCountsReported).toBe(false);
    });
  });

  describe("lastFor", () => {
    it("returns the newest record for a model", () => {
      const registry = new InferenceMetricsRegistry();
      registry.record(rec({ at: 1 }));
      registry.record(rec({ at: 9 }));
      registry.record(rec({ model: "other", at: 5 }));
      expect(registry.lastFor("gemma4:12b")?.at).toBe(9);
    });

    it("returns null for an unknown model", () => {
      expect(new InferenceMetricsRegistry().lastFor("nope")).toBeNull();
    });
  });

  it("publishes to an attached publisher", () => {
    const seen: InferenceMetricRecord[] = [];
    const registry = new InferenceMetricsRegistry({
      publisher: { publish: (r) => seen.push(r) },
    });
    registry.record(rec());
    expect(seen).toHaveLength(1);
  });

  it("survives a throwing publisher", () => {
    const registry = new InferenceMetricsRegistry({
      publisher: {
        publish: () => {
          throw new Error("bad subscriber");
        },
      },
    });
    expect(() => registry.record(rec())).not.toThrow();
  });
});

describe("createTelemetryMetricPublisher", () => {
  it("publishes model.inference.complete onto the existing bus", () => {
    const bus = new InProcessTelemetryBus();
    const seen: TelemetryEvent[] = [];
    bus.subscribe({ kinds: ["model.inference.complete"] }, (e) => seen.push(e));
    const registry = new InferenceMetricsRegistry({
      publisher: createTelemetryMetricPublisher(bus, "coding"),
    });
    registry.record(rec());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.source).toBe("coding");
    expect((seen[0]?.payload as InferenceMetricRecord).model).toBe("gemma4:12b");
  });
});

describe("metricSpanAttributes", () => {
  it("flattens a full record", () => {
    expect(metricSpanAttributes(rec())).toEqual({
      inferenceTotalMs: 1000,
      tokenSource: "reported",
      adapter: "ollama",
      promptTokens: 10,
      completionTokens: 20,
      ttftMs: 100,
      tokensPerSec: 20,
      memoryBytes: 1024,
    });
  });

  it("omits absent metrics rather than asserting zeros", () => {
    const attrs = metricSpanAttributes(
      rec({
        adapter: null,
        promptTokens: null,
        completionTokens: null,
        ttftMs: null,
        tokensPerSec: null,
        memoryBytes: null,
        tokenSource: "unavailable",
      }),
    );
    expect(attrs).toEqual({ inferenceTotalMs: 1000, tokenSource: "unavailable" });
    expect("tokensPerSec" in attrs).toBe(false);
  });
});

describe("sharedInferenceMetrics", () => {
  it("returns a stable singleton", () => {
    setSharedInferenceMetrics(null);
    const a = sharedInferenceMetrics();
    expect(sharedInferenceMetrics()).toBe(a);
  });

  it("can be replaced and reset for test isolation", () => {
    const injected = new InferenceMetricsRegistry();
    setSharedInferenceMetrics(injected);
    expect(sharedInferenceMetrics()).toBe(injected);
    setSharedInferenceMetrics(null);
    expect(sharedInferenceMetrics()).not.toBe(injected);
  });

  it("does not leak the vi mock registry between suites", () => {
    // Guard against a future test forgetting to reset; documents the contract.
    setSharedInferenceMetrics(null);
    expect(vi.isMockFunction(sharedInferenceMetrics)).toBe(false);
  });
});
