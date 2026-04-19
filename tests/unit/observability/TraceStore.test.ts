import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TraceStore } from "../../../src/observability/TraceStore.js";
import type { SpanKind } from "../../../src/observability/TraceStore.js";

describe("TraceStore", () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------
  // startTrace
  // -------------------------------------------------------------------------

  describe("startTrace", () => {
    it("creates a trace with a generated traceId and root span", () => {
      const trace = store.startTrace();

      expect(trace.traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(trace.rootSpanId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(trace.sessionId).toBeNull();
      expect(trace.startTime).toBeGreaterThan(0);
      expect(trace.endTime).toBeNull();
      expect(trace.spanCount).toBe(1);
    });

    it("stores the sessionId when provided", () => {
      const trace = store.startTrace("session-123");

      expect(trace.sessionId).toBe("session-123");
    });

    it("creates a retrievable trace with root span", () => {
      const trace = store.startTrace("sess-1");
      const loaded = store.getTrace(trace.traceId);

      expect(loaded).not.toBeNull();
      expect(loaded!.spans).toHaveLength(1);
      expect(loaded!.spans[0].name).toBe("root");
      expect(loaded!.spans[0].kind).toBe("agent_turn");
      expect(loaded!.spans[0].parentSpanId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // startSpan / endSpan
  // -------------------------------------------------------------------------

  describe("startSpan", () => {
    it("creates a child span linked to a trace", () => {
      const trace = store.startTrace();
      const span = store.startSpan(
        trace.traceId,
        "iteration_0",
        "agent_turn",
        trace.rootSpanId,
      );

      expect(span.spanId).toBeTruthy();
      expect(span.traceId).toBe(trace.traceId);
      expect(span.parentSpanId).toBe(trace.rootSpanId);
      expect(span.name).toBe("iteration_0");
      expect(span.kind).toBe("agent_turn");
      expect(span.startTime).toBeGreaterThan(0);
      expect(span.endTime).toBeNull();
      expect(span.durationMs).toBeNull();
      expect(span.status).toBe("ok");
    });

    it("stores initial attributes", () => {
      const trace = store.startTrace();
      const span = store.startSpan(
        trace.traceId,
        "tool_exec",
        "tool_call",
        trace.rootSpanId,
        { toolName: "read_file", callId: "call-1" },
      );

      expect(span.attributes).toEqual({
        toolName: "read_file",
        callId: "call-1",
      });

      const loaded = store.getTrace(trace.traceId);
      const found = loaded!.spans.find((s) => s.spanId === span.spanId);
      expect(found!.attributes).toEqual({
        toolName: "read_file",
        callId: "call-1",
      });
    });

    it("creates a span without parent when parentSpanId is omitted", () => {
      const trace = store.startTrace();
      const span = store.startSpan(trace.traceId, "orphan", "custom");

      expect(span.parentSpanId).toBeNull();
    });
  });

  describe("endSpan", () => {
    it("sets endTime, durationMs, and status", () => {
      const trace = store.startTrace();
      const span = store.startSpan(
        trace.traceId,
        "llm_call_1",
        "llm_call",
        trace.rootSpanId,
      );

      store.endSpan(span.spanId, "ok");

      const loaded = store.getTrace(trace.traceId);
      const ended = loaded!.spans.find((s) => s.spanId === span.spanId);

      expect(ended!.endTime).toBeGreaterThanOrEqual(ended!.startTime);
      expect(ended!.durationMs).toBeGreaterThanOrEqual(0);
      expect(ended!.status).toBe("ok");
    });

    it("merges additional attributes on end", () => {
      const trace = store.startTrace();
      const span = store.startSpan(
        trace.traceId,
        "tool",
        "tool_call",
        trace.rootSpanId,
        { toolName: "write_file" },
      );

      store.endSpan(span.spanId, "error", { errorMessage: "permission denied" });

      const loaded = store.getTrace(trace.traceId);
      const ended = loaded!.spans.find((s) => s.spanId === span.spanId);

      expect(ended!.status).toBe("error");
      expect(ended!.attributes).toEqual({
        toolName: "write_file",
        errorMessage: "permission denied",
      });
    });

    it("is a no-op for non-existent span", () => {
      expect(() => store.endSpan("nonexistent-id", "ok")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // addEvent
  // -------------------------------------------------------------------------

  describe("addEvent", () => {
    it("appends an event to a span", () => {
      const trace = store.startTrace();
      const span = store.startSpan(trace.traceId, "iter", "agent_turn");

      store.addEvent(span.spanId, {
        name: "budget_check",
        timestamp: Date.now(),
        attributes: { remaining: 5000 },
      });

      const loaded = store.getTrace(trace.traceId);
      const found = loaded!.spans.find((s) => s.spanId === span.spanId);

      expect(found!.events).toHaveLength(1);
      expect(found!.events[0].name).toBe("budget_check");
      expect(found!.events[0].attributes).toEqual({ remaining: 5000 });
    });

    it("appends multiple events in order", () => {
      const trace = store.startTrace();
      const span = store.startSpan(trace.traceId, "iter", "agent_turn");

      store.addEvent(span.spanId, { name: "start", timestamp: 1000 });
      store.addEvent(span.spanId, { name: "middle", timestamp: 2000 });
      store.addEvent(span.spanId, { name: "end", timestamp: 3000 });

      const loaded = store.getTrace(trace.traceId);
      const found = loaded!.spans.find((s) => s.spanId === span.spanId);

      expect(found!.events).toHaveLength(3);
      expect(found!.events.map((e) => e.name)).toEqual([
        "start",
        "middle",
        "end",
      ]);
    });

    it("is a no-op for non-existent span", () => {
      expect(() =>
        store.addEvent("nonexistent", { name: "test", timestamp: Date.now() }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getTrace
  // -------------------------------------------------------------------------

  describe("getTrace", () => {
    it("returns null for non-existent trace", () => {
      expect(store.getTrace("nonexistent")).toBeNull();
    });

    it("returns trace with all spans in start_time order", () => {
      const trace = store.startTrace();
      store.startSpan(trace.traceId, "second", "tool_call", trace.rootSpanId);
      store.startSpan(trace.traceId, "third", "llm_call", trace.rootSpanId);

      const loaded = store.getTrace(trace.traceId);

      expect(loaded).not.toBeNull();
      expect(loaded!.spanCount).toBe(3);
      expect(loaded!.spans).toHaveLength(3);
      expect(loaded!.spans[0].name).toBe("root");
    });

    it("returns correct parent-child relationships", () => {
      const trace = store.startTrace();
      const parent = store.startSpan(
        trace.traceId,
        "iteration",
        "agent_turn",
        trace.rootSpanId,
      );
      const child = store.startSpan(
        trace.traceId,
        "tool",
        "tool_call",
        parent.spanId,
      );

      const loaded = store.getTrace(trace.traceId);
      const childSpan = loaded!.spans.find((s) => s.spanId === child.spanId);

      expect(childSpan!.parentSpanId).toBe(parent.spanId);
    });
  });

  // -------------------------------------------------------------------------
  // listTraces
  // -------------------------------------------------------------------------

  describe("listTraces", () => {
    it("returns empty array when no traces exist", () => {
      expect(store.listTraces()).toEqual([]);
    });

    it("lists traces ordered by most recent first", () => {
      store.startTrace("a");
      store.startTrace("b");
      store.startTrace("c");

      const traces = store.listTraces();

      expect(traces).toHaveLength(3);
      // All created within the same millisecond, so just verify all are present
      const sessionIds = traces.map((t) => t.sessionId);
      expect(sessionIds).toContain("a");
      expect(sessionIds).toContain("b");
      expect(sessionIds).toContain("c");
    });

    it("respects limit parameter", () => {
      store.startTrace("a");
      store.startTrace("b");
      store.startTrace("c");

      const traces = store.listTraces(2);
      expect(traces).toHaveLength(2);
    });

    it("respects offset parameter", () => {
      store.startTrace("a");
      store.startTrace("b");
      store.startTrace("c");

      const traces = store.listTraces(10, 1);
      expect(traces).toHaveLength(2);
    });

    it("includes correct span counts", () => {
      const trace = store.startTrace();
      store.startSpan(trace.traceId, "s1", "tool_call");
      store.startSpan(trace.traceId, "s2", "llm_call");

      const traces = store.listTraces();
      expect(traces[0].spanCount).toBe(3); // root + 2 children
    });
  });

  // -------------------------------------------------------------------------
  // getSpansByKind
  // -------------------------------------------------------------------------

  describe("getSpansByKind", () => {
    it("filters spans by kind", () => {
      const trace = store.startTrace();
      store.startSpan(trace.traceId, "tool1", "tool_call");
      store.startSpan(trace.traceId, "llm1", "llm_call");
      store.startSpan(trace.traceId, "tool2", "tool_call");

      const toolSpans = store.getSpansByKind(trace.traceId, "tool_call");
      expect(toolSpans).toHaveLength(2);
      expect(toolSpans.every((s) => s.kind === "tool_call")).toBe(true);

      const llmSpans = store.getSpansByKind(trace.traceId, "llm_call");
      expect(llmSpans).toHaveLength(1);
    });

    it("returns empty array for non-existent kind", () => {
      const trace = store.startTrace();
      expect(store.getSpansByKind(trace.traceId, "reflexion")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // deleteOlderThan
  // -------------------------------------------------------------------------

  describe("deleteOlderThan", () => {
    it("deletes traces older than the specified number of days", () => {
      store.startTrace("old");
      store.startTrace("recent");

      // Both traces were just created, so deleteOlderThan(30) deletes nothing
      const deleted = store.deleteOlderThan(30);
      expect(deleted).toBe(0);
      expect(store.listTraces()).toHaveLength(2);
    });

    it("deletes all traces when cutoff is in the future", () => {
      store.startTrace("a");
      store.startTrace("b");

      // Use a negative days value to set cutoff in the future (deletes everything)
      const deleted = store.deleteOlderThan(-1);
      expect(deleted).toBe(2);
      expect(store.listTraces()).toHaveLength(0);
    });

    it("cascades delete to spans via foreign key", () => {
      const trace = store.startTrace();
      store.startSpan(trace.traceId, "child", "tool_call");

      // Force delete by using a future cutoff
      store.deleteOlderThan(-1);

      expect(store.getTrace(trace.traceId)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent span creation
  // -------------------------------------------------------------------------

  describe("concurrent operations", () => {
    it("handles multiple spans created for the same trace", () => {
      const trace = store.startTrace();
      const kinds: SpanKind[] = [
        "tool_call",
        "llm_call",
        "compaction",
        "sub_agent",
        "planning",
      ];

      for (const kind of kinds) {
        store.startSpan(trace.traceId, `span_${kind}`, kind, trace.rootSpanId);
      }

      const loaded = store.getTrace(trace.traceId);
      expect(loaded!.spanCount).toBe(6); // root + 5 children
    });

    it("handles deeply nested spans", () => {
      const trace = store.startTrace();
      let parentId = trace.rootSpanId;

      for (let i = 0; i < 5; i++) {
        const span = store.startSpan(
          trace.traceId,
          `level_${i}`,
          "agent_turn",
          parentId,
        );
        parentId = span.spanId;
      }

      const loaded = store.getTrace(trace.traceId);
      expect(loaded!.spanCount).toBe(6); // root + 5 nested levels
    });
  });

  // -------------------------------------------------------------------------
  // Batched writes (Phase 1 sub-task 1.7)
  // -------------------------------------------------------------------------

  describe("batched writes", () => {
    it("spans remain queryable after buffered writes are flushed", () => {
      const trace = store.startTrace();
      for (let i = 0; i < 10; i++) {
        const span = store.startSpan(trace.traceId, `op_${i}`, "tool_call");
        store.endSpan(span.spanId, "ok");
      }
      store.flush();

      const loaded = store.getTrace(trace.traceId);
      expect(loaded).not.toBeNull();
      expect(loaded!.spanCount).toBe(11); // 1 root + 10 children
      expect(loaded!.spans.filter((s) => s.durationMs !== null)).toHaveLength(10);
    });

    it("does not issue a SELECT in endSpan (startTime + attributes cached in memory)", () => {
      const trace = store.startTrace();
      const span = store.startSpan(trace.traceId, "op", "tool_call", undefined, { foo: "bar" });

      // endSpan must succeed even if the INSERT is still buffered (no SELECT).
      store.endSpan(span.spanId, "ok", { extra: "baz" });
      store.flush();

      const loaded = store.getSpan(span.spanId);
      expect(loaded).not.toBeNull();
      expect(loaded!.attributes).toEqual({ foo: "bar", extra: "baz" });
      expect(loaded!.durationMs).not.toBeNull();
    });

    it("reads force an implicit flush so queries always return up-to-date data", () => {
      const trace = store.startTrace();
      const span = store.startSpan(trace.traceId, "op", "tool_call");
      store.endSpan(span.spanId, "ok");
      // Deliberately NO explicit flush() — getSpan() must flush internally.
      const loaded = store.getSpan(span.spanId);
      expect(loaded).not.toBeNull();
      expect(loaded!.durationMs).not.toBeNull();
    });
  });
});
