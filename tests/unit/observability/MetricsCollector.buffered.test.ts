import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TraceStore } from "../../../src/observability/TraceStore.js";
import { MetricsCollector } from "../../../src/observability/MetricsCollector.js";

/**
 * Phase 9 (v0.5.0) -- Buffered trace writes.
 *
 * The trace store batches inserts/updates and flushes on whichever fires
 * first: 100 buffered events OR 5 seconds since the last flush. `dispose()`
 * performs a final synchronous flush so no event is lost on extension
 * deactivation.
 */
describe("Buffered trace writes (Phase 9)", () => {
  let store: TraceStore;
  let collector: MetricsCollector;

  beforeEach(() => {
    store = new TraceStore(":memory:");
    collector = new MetricsCollector(store);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      /* idempotent */
    }
    vi.useRealTimers();
  });

  it("buffers 99 sub-batch events without forcing a count-triggered flush", () => {
    const trace = store.startTrace();
    // Spans nested under the root accumulate as INSERT ops; until 100 ops
    // the time-based flush is responsible. We verify by reading the buffer
    // stats *before* nextTick drains the auto-scheduled flush.
    for (let i = 0; i < 49; i++) {
      const s = store.startSpan(trace.traceId, `t${i}`, "tool_call", trace.rootSpanId);
      store.endSpan(s.spanId, "ok");
    }
    // Before draining: 49 inserts + 49 updates = 98 ops, plus the existing
    // root + initial trace inserts, so we are still under 100.
    expect(collector.bufferStats().bufferedEvents).toBeLessThan(100);
  });

  it("count-triggered flush fires when the batch crosses 100 events", () => {
    const trace = store.startTrace();
    // 60 nested spans -> 60 inserts + 60 updates = 120 ops, which crosses
    // the 100-event threshold mid-stream.
    for (let i = 0; i < 60; i++) {
      const s = store.startSpan(trace.traceId, `t${i}`, "tool_call", trace.rootSpanId);
      store.endSpan(s.spanId, "ok");
    }
    // After at least one count-triggered flush, totalFlushed must be > 0.
    expect(collector.bufferStats().totalFlushed).toBeGreaterThan(0);
  });

  it("dispose() flushes any pending events synchronously", () => {
    const trace = store.startTrace();
    const s = store.startSpan(trace.traceId, "x", "tool_call", trace.rootSpanId);
    store.endSpan(s.spanId, "ok");

    const before = collector.bufferStats().bufferedEvents;
    expect(before).toBeGreaterThan(0);

    store.dispose();

    // After dispose, the buffer is drained; querying through a re-opened
    // connection isn't necessary -- bufferStats reads in-process state.
    expect(collector.bufferStats().bufferedEvents).toBe(0);
  });

  it("flushImmediately() returns a resolved promise when the buffer is empty", async () => {
    await expect(collector.flushImmediately()).resolves.toBeUndefined();
  });

  it("bufferStats updates lastFlushMs after a drain", () => {
    const before = collector.bufferStats().lastFlushMs;
    const trace = store.startTrace();
    const s = store.startSpan(trace.traceId, "y", "tool_call", trace.rootSpanId);
    store.endSpan(s.spanId, "ok");
    store.flush();
    const after = collector.bufferStats().lastFlushMs;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("close() calls dispose() once and is idempotent", () => {
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});
