import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TraceStore } from "../../../src/observability/TraceStore.js";
import { MetricsCollector } from "../../../src/observability/MetricsCollector.js";

/**
 * We test the TraceDashboardPanel logic indirectly by testing
 * the underlying data flow (TraceStore + MetricsCollector) since
 * the panel itself requires the vscode module. The panel is a thin
 * layer that calls these methods and forwards the results via postMessage.
 */
describe("TraceDashboardPanel data flow", () => {
  let store: TraceStore;
  let collector: MetricsCollector;

  beforeEach(() => {
    store = new TraceStore(":memory:");
    collector = new MetricsCollector(store);
  });

  afterEach(() => {
    store.close();
  });

  describe("requestTraceList flow", () => {
    it("returns an empty list when no traces exist", () => {
      const traces = store.listTraces(50);
      expect(traces).toEqual([]);
    });

    it("returns traces with span counts and durations", () => {
      const trace = store.startTrace("session-1");
      store.startSpan(trace.traceId, "tool1", "tool_call", trace.rootSpanId);
      store.endSpan(trace.rootSpanId, "ok");

      const traces = store.listTraces(50);
      expect(traces).toHaveLength(1);
      expect(traces[0].spanCount).toBe(2);

      const rootSpan = store.getSpan(traces[0].rootSpanId);
      expect(rootSpan).not.toBeNull();
      expect(rootSpan!.status).toBe("ok");
    });
  });

  describe("requestTraceDetail flow", () => {
    it("returns full span tree for a trace", () => {
      const trace = store.startTrace();
      const span1 = store.startSpan(trace.traceId, "iter_0", "agent_turn", trace.rootSpanId);
      const span2 = store.startSpan(trace.traceId, "llm_0", "llm_call", span1.spanId);
      store.endSpan(span2.spanId, "ok");
      store.endSpan(span1.spanId, "ok");
      store.endSpan(trace.rootSpanId, "ok");

      const detail = store.getTrace(trace.traceId);
      expect(detail).not.toBeNull();
      expect(detail!.spans).toHaveLength(3);
      expect(detail!.spans[0].name).toBe("root");
    });

    it("returns null for non-existent trace", () => {
      expect(store.getTrace("nonexistent")).toBeNull();
    });
  });

  describe("requestTraceMetrics flow", () => {
    it("computes metrics for a trace with tool calls", () => {
      const trace = store.startTrace();
      const s1 = store.startSpan(trace.traceId, "tool1", "tool_call");
      store.endSpan(s1.spanId, "ok");
      const s2 = store.startSpan(trace.traceId, "tool2", "tool_call");
      store.endSpan(s2.spanId, "error");
      const s3 = store.startSpan(trace.traceId, "llm1", "llm_call");
      store.endSpan(s3.spanId, "ok");
      store.endSpan(trace.rootSpanId, "ok");

      const metrics = collector.computeSessionMetrics(trace.traceId);
      expect(metrics).not.toBeNull();
      expect(metrics!.toolStepCount).toBe(2);
      expect(metrics!.llmCallCount).toBe(1);
      expect(metrics!.successRate).toBe(0.5);
    });

    it("returns null for non-existent trace", () => {
      expect(collector.computeSessionMetrics("nonexistent")).toBeNull();
    });
  });
});
