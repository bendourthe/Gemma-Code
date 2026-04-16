import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Tracer } from "../../../src/observability/Tracer.js";
import { TraceStore } from "../../../src/observability/TraceStore.js";
import type { TracerExporter } from "../../../src/observability/Tracer.js";
import type { Span } from "../../../src/observability/TraceStore.js";

describe("Tracer", () => {
  let tracer: Tracer;
  let store: TraceStore;

  beforeEach(() => {
    Tracer.resetInstance();
    tracer = Tracer.getInstance();
    store = new TraceStore(":memory:");
    tracer.init(store);
  });

  afterEach(() => {
    store.close();
    Tracer.resetInstance();
  });

  // -------------------------------------------------------------------------
  // Singleton
  // -------------------------------------------------------------------------

  describe("singleton", () => {
    it("returns the same instance on multiple calls", () => {
      const a = Tracer.getInstance();
      const b = Tracer.getInstance();
      expect(a).toBe(b);
    });

    it("returns a fresh instance after resetInstance()", () => {
      const before = Tracer.getInstance();
      Tracer.resetInstance();
      const after = Tracer.getInstance();
      expect(before).not.toBe(after);
    });
  });

  // -------------------------------------------------------------------------
  // No-op when uninitialized
  // -------------------------------------------------------------------------

  describe("no-op mode", () => {
    it("returns empty strings when store is null", () => {
      Tracer.resetInstance();
      const uninit = Tracer.getInstance();

      expect(uninit.enabled).toBe(false);
      expect(uninit.startTrace()).toBe("");
      expect(uninit.startSpan("t", "name", "tool_call")).toBe("");
    });

    it("does not throw when ending non-existent spans", () => {
      Tracer.resetInstance();
      const uninit = Tracer.getInstance();

      expect(() => uninit.endSpan("x", "ok")).not.toThrow();
      expect(() => uninit.addEvent("x", "ev")).not.toThrow();
    });

    it("returns empty string for getRootSpanId when uninitialized", () => {
      Tracer.resetInstance();
      const uninit = Tracer.getInstance();
      expect(uninit.getRootSpanId("any")).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Trace creation
  // -------------------------------------------------------------------------

  describe("startTrace", () => {
    it("returns a valid traceId", () => {
      const traceId = tracer.startTrace();
      expect(traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("creates a trace in the store", () => {
      const traceId = tracer.startTrace("session-1");
      const trace = store.getTrace(traceId);
      expect(trace).not.toBeNull();
      expect(trace!.sessionId).toBe("session-1");
    });
  });

  // -------------------------------------------------------------------------
  // Span lifecycle
  // -------------------------------------------------------------------------

  describe("startSpan / endSpan", () => {
    it("creates and ends a span", () => {
      const traceId = tracer.startTrace();
      const rootSpanId = tracer.getRootSpanId(traceId);
      const spanId = tracer.startSpan(
        traceId,
        "tool_exec",
        "tool_call",
        rootSpanId,
        { toolName: "read_file" },
      );

      expect(spanId).toBeTruthy();

      tracer.endSpan(spanId, "ok", { success: true });

      const trace = store.getTrace(traceId);
      const span = trace!.spans.find((s) => s.spanId === spanId);
      expect(span!.status).toBe("ok");
      expect(span!.endTime).not.toBeNull();
      expect(span!.attributes).toEqual({
        toolName: "read_file",
        success: true,
      });
    });

    it("returns empty string for empty traceId", () => {
      const spanId = tracer.startSpan("", "name", "custom");
      expect(spanId).toBe("");
    });

    it("is a no-op when ending empty spanId", () => {
      expect(() => tracer.endSpan("", "ok")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Nested spans
  // -------------------------------------------------------------------------

  describe("nested spans", () => {
    it("supports parent-child span relationships", () => {
      const traceId = tracer.startTrace();
      const rootSpanId = tracer.getRootSpanId(traceId);

      const iterSpanId = tracer.startSpan(
        traceId,
        "iteration_0",
        "agent_turn",
        rootSpanId,
      );
      const llmSpanId = tracer.startSpan(
        traceId,
        "stream_turn",
        "llm_call",
        iterSpanId,
      );
      const toolSpanId = tracer.startSpan(
        traceId,
        "read_file",
        "tool_call",
        iterSpanId,
      );

      tracer.endSpan(toolSpanId, "ok");
      tracer.endSpan(llmSpanId, "ok");
      tracer.endSpan(iterSpanId, "ok");

      const trace = store.getTrace(traceId);
      expect(trace!.spans).toHaveLength(4); // root + 3

      const llmSpan = trace!.spans.find((s) => s.spanId === llmSpanId);
      expect(llmSpan!.parentSpanId).toBe(iterSpanId);

      const toolSpan = trace!.spans.find((s) => s.spanId === toolSpanId);
      expect(toolSpan!.parentSpanId).toBe(iterSpanId);
    });
  });

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  describe("addEvent", () => {
    it("adds an event to a span", () => {
      const traceId = tracer.startTrace();
      const spanId = tracer.startSpan(traceId, "iter", "agent_turn");

      tracer.addEvent(spanId, "budget_check", { tokensRemaining: 5000 });

      const trace = store.getTrace(traceId);
      const span = trace!.spans.find((s) => s.spanId === spanId);
      expect(span!.events).toHaveLength(1);
      expect(span!.events[0].name).toBe("budget_check");
    });

    it("is a no-op for empty spanId", () => {
      expect(() => tracer.addEvent("", "ev")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Exporter integration
  // -------------------------------------------------------------------------

  describe("exporter", () => {
    it("enqueues completed spans to the exporter", () => {
      const exported: Span[] = [];
      const exporter: TracerExporter = {
        enqueueSpan(span: Span) {
          exported.push(span);
        },
      };
      tracer.setExporter(exporter);

      const traceId = tracer.startTrace();
      const spanId = tracer.startSpan(traceId, "tool", "tool_call");
      tracer.endSpan(spanId, "ok");

      expect(exported).toHaveLength(1);
      expect(exported[0].spanId).toBe(spanId);
      expect(exported[0].status).toBe("ok");
    });

    it("does not export when no exporter is set", () => {
      const traceId = tracer.startTrace();
      const spanId = tracer.startSpan(traceId, "tool", "tool_call");
      // No exporter set -- should not throw
      expect(() => tracer.endSpan(spanId, "ok")).not.toThrow();
    });

    it("stops exporting after setExporter(null)", () => {
      const exported: Span[] = [];
      const exporter: TracerExporter = {
        enqueueSpan(span: Span) {
          exported.push(span);
        },
      };
      tracer.setExporter(exporter);

      const traceId = tracer.startTrace();
      const span1 = tracer.startSpan(traceId, "s1", "tool_call");
      tracer.endSpan(span1, "ok");
      expect(exported).toHaveLength(1);

      tracer.setExporter(null);
      const span2 = tracer.startSpan(traceId, "s2", "tool_call");
      tracer.endSpan(span2, "ok");
      expect(exported).toHaveLength(1); // no new export
    });
  });

  // -------------------------------------------------------------------------
  // getRootSpanId
  // -------------------------------------------------------------------------

  describe("getRootSpanId", () => {
    it("returns the root span ID for a trace", () => {
      const traceId = tracer.startTrace();
      const rootSpanId = tracer.getRootSpanId(traceId);
      expect(rootSpanId).toBeTruthy();

      const trace = store.getTrace(traceId);
      expect(rootSpanId).toBe(trace!.rootSpanId);
    });

    it("returns empty string for non-existent trace", () => {
      expect(tracer.getRootSpanId("nonexistent")).toBe("");
    });
  });
});
