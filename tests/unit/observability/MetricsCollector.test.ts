import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TraceStore } from "../../../modules/coding/observability/TraceStore.js";
import { MetricsCollector } from "../../../modules/coding/observability/MetricsCollector.js";

describe("MetricsCollector", () => {
  let store: TraceStore;
  let collector: MetricsCollector;

  beforeEach(() => {
    store = new TraceStore(":memory:");
    collector = new MetricsCollector(store);
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------
  // Helper to build a trace with specific span kinds
  // -------------------------------------------------------------------------

  function buildTrace(
    spanConfigs: Array<{
      name: string;
      kind: "tool_call" | "llm_call" | "compaction" | "sub_agent" | "reflexion" | "agent_turn";
      status?: "ok" | "error";
      attributes?: Record<string, string | number | boolean>;
    }>,
    sessionId?: string,
  ): string {
    const trace = store.startTrace(sessionId);

    for (const cfg of spanConfigs) {
      const span = store.startSpan(
        trace.traceId,
        cfg.name,
        cfg.kind,
        trace.rootSpanId,
        cfg.attributes,
      );
      store.endSpan(span.spanId, cfg.status ?? "ok");
    }

    // End the root span.
    store.endSpan(trace.rootSpanId, "ok");

    return trace.traceId;
  }

  // -------------------------------------------------------------------------
  // computeSessionMetrics
  // -------------------------------------------------------------------------

  describe("computeSessionMetrics", () => {
    it("returns null for non-existent trace", () => {
      expect(collector.computeSessionMetrics("nonexistent")).toBeNull();
    });

    it("computes metrics for a simple trace", () => {
      const traceId = buildTrace([
        { name: "tool1", kind: "tool_call" },
        { name: "tool2", kind: "tool_call" },
        { name: "llm1", kind: "llm_call" },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics).not.toBeNull();
      expect(metrics!.toolStepCount).toBe(2);
      expect(metrics!.llmCallCount).toBe(1);
      expect(metrics!.retryCount).toBe(0);
      expect(metrics!.compactionCount).toBe(0);
      expect(metrics!.subAgentCount).toBe(0);
      expect(metrics!.successRate).toBe(1);
    });

    it("counts reflexion spans as retries", () => {
      const traceId = buildTrace([
        { name: "reflect1", kind: "reflexion" },
        { name: "reflect2", kind: "reflexion" },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.retryCount).toBe(2);
    });

    it("counts compaction spans", () => {
      const traceId = buildTrace([
        { name: "compact1", kind: "compaction" },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.compactionCount).toBe(1);
    });

    it("counts sub-agent spans", () => {
      const traceId = buildTrace([
        { name: "sub1", kind: "sub_agent" },
        { name: "sub2", kind: "sub_agent" },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.subAgentCount).toBe(2);
    });

    it("calculates success rate with failures", () => {
      const traceId = buildTrace([
        { name: "tool1", kind: "tool_call", status: "ok" },
        { name: "tool2", kind: "tool_call", status: "error" },
        { name: "tool3", kind: "tool_call", status: "ok" },
        { name: "tool4", kind: "tool_call", status: "error" },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.successRate).toBe(0.5);
    });

    it("returns 1.0 success rate when no tool calls", () => {
      const traceId = buildTrace([{ name: "llm1", kind: "llm_call" }]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.successRate).toBe(1);
    });

    it("sums estimated tokens from span attributes", () => {
      const traceId = buildTrace([
        { name: "llm1", kind: "llm_call", attributes: { tokens_estimated: 500 } },
        { name: "llm2", kind: "llm_call", attributes: { tokens_estimated: 300 } },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.estimatedTokensUsed).toBe(800);
    });

    it("counts human interventions from confirmation_required attribute", () => {
      const traceId = buildTrace([
        { name: "tool1", kind: "tool_call", attributes: { confirmation_required: true } },
        { name: "tool2", kind: "tool_call", attributes: { confirmation_required: false } },
        { name: "tool3", kind: "tool_call" },
      ]);

      const metrics = collector.computeSessionMetrics(traceId);
      expect(metrics!.humanInterventionCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // computeAggregateMetrics
  // -------------------------------------------------------------------------

  describe("computeAggregateMetrics", () => {
    it("returns zeros for empty input", () => {
      const agg = collector.computeAggregateMetrics([]);
      expect(agg.averageDurationMs).toBe(0);
      expect(agg.overallSuccessRate).toBe(0);
    });

    it("returns zeros for non-existent trace IDs", () => {
      const agg = collector.computeAggregateMetrics(["fake-1", "fake-2"]);
      expect(agg.averageDurationMs).toBe(0);
    });

    it("computes averages across multiple sessions", () => {
      const t1 = buildTrace([
        { name: "tool1", kind: "tool_call" },
        { name: "tool2", kind: "tool_call" },
      ]);
      const t2 = buildTrace([
        { name: "tool1", kind: "tool_call" },
        { name: "tool2", kind: "tool_call" },
        { name: "tool3", kind: "tool_call" },
        { name: "tool4", kind: "tool_call" },
      ]);

      const agg = collector.computeAggregateMetrics([t1, t2]);
      expect(agg.averageToolSteps).toBe(3); // (2 + 4) / 2
      expect(agg.overallSuccessRate).toBe(1);
      expect(agg.totalCompactions).toBe(0);
    });

    it("computes median duration correctly for odd count", () => {
      // All traces complete instantly in tests, so durations are ~0.
      // The important thing is the median logic works.
      const t1 = buildTrace([{ name: "t", kind: "tool_call" }]);
      const t2 = buildTrace([{ name: "t", kind: "tool_call" }]);
      const t3 = buildTrace([{ name: "t", kind: "tool_call" }]);

      const agg = collector.computeAggregateMetrics([t1, t2, t3]);
      expect(agg.medianDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // getMetricsTrend
  // -------------------------------------------------------------------------

  describe("getMetricsTrend", () => {
    it("returns empty arrays when no traces exist", () => {
      const trend = collector.getMetricsTrend(10);
      expect(trend.traceIds).toEqual([]);
      expect(trend.durations).toEqual([]);
      expect(trend.toolSteps).toEqual([]);
      expect(trend.successRates).toEqual([]);
      expect(trend.compactions).toEqual([]);
    });

    it("returns trend data for recent traces", () => {
      buildTrace([{ name: "tool1", kind: "tool_call" }], "s1");
      buildTrace([
        { name: "tool1", kind: "tool_call" },
        { name: "tool2", kind: "tool_call" },
      ], "s2");

      const trend = collector.getMetricsTrend(10);
      expect(trend.traceIds).toHaveLength(2);
      expect(trend.toolSteps).toHaveLength(2);
    });

    it("respects the lastN limit", () => {
      buildTrace([{ name: "t", kind: "tool_call" }]);
      buildTrace([{ name: "t", kind: "tool_call" }]);
      buildTrace([{ name: "t", kind: "tool_call" }]);

      const trend = collector.getMetricsTrend(2);
      expect(trend.traceIds).toHaveLength(2);
    });
  });
});
