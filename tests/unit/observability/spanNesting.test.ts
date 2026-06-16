import { describe, it, expect } from "vitest";
import type { Span, SpanKind } from "../../../modules/coding/observability/TraceStore.js";
import {
  flattenSpanForest,
  hasRunNesting,
} from "../../../modules/coding/observability/spanNesting.js";

// v1.6.0 Phase 4 (A2) -- the shared run-nesting logic the Trace Dashboard and
// the A4 export both lean on. These tests pin the two behaviors the Stability
// Gate requires: a nested run tree when the swarm fields are present, and the
// flat start-time timeline (depth 0) when they are absent.

let seq = 0;
function makeSpan(overrides: Partial<Span> & { spanId: string }): Span {
  seq += 1;
  return {
    traceId: "trace-1",
    parentSpanId: null,
    name: overrides.spanId,
    kind: "custom" as SpanKind,
    startTime: seq,
    endTime: seq + 1,
    durationMs: 1,
    status: "ok",
    attributes: {},
    events: [],
    groupId: null,
    parentRunId: null,
    ...overrides,
  };
}

describe("flattenSpanForest", () => {
  describe("flat fallback (no run-nesting fields)", () => {
    it("returns spans in start-time order, all at depth 0", () => {
      const spans = [
        makeSpan({ spanId: "c", startTime: 30 }),
        makeSpan({ spanId: "a", startTime: 10 }),
        makeSpan({ spanId: "b", startTime: 20 }),
      ];

      const entries = flattenSpanForest(spans);

      expect(entries.map((e) => e.span.spanId)).toEqual(["a", "b", "c"]);
      expect(entries.every((e) => e.depth === 0)).toBe(true);
    });

    it("hasRunNesting is false when no span carries group/parent-run ids", () => {
      const spans = [makeSpan({ spanId: "a" }), makeSpan({ spanId: "b" })];
      expect(hasRunNesting(spans)).toBe(false);
    });

    it("does not mutate the input array", () => {
      const spans = [
        makeSpan({ spanId: "z", startTime: 99 }),
        makeSpan({ spanId: "y", startTime: 1 }),
      ];
      const before = spans.map((s) => s.spanId);
      flattenSpanForest(spans);
      expect(spans.map((s) => s.spanId)).toEqual(before);
    });
  });

  describe("nested run tree (planner -> worker -> critic)", () => {
    it("nests workers under the planner and critics under their worker", () => {
      const planner = makeSpan({ spanId: "planner", kind: "agent_turn", startTime: 1 });
      const worker = makeSpan({
        spanId: "worker",
        kind: "sub_agent",
        startTime: 2,
        groupId: "g1",
        parentRunId: "planner",
      });
      const critic = makeSpan({
        spanId: "critic",
        kind: "critic",
        startTime: 3,
        groupId: "g1",
        parentRunId: "worker",
      });

      const entries = flattenSpanForest([critic, planner, worker]);

      expect(hasRunNesting([planner, worker, critic])).toBe(true);
      // Pre-order: planner (root), then its worker, then the worker's critic.
      expect(entries.map((e) => [e.span.spanId, e.depth])).toEqual([
        ["planner", 0],
        ["worker", 1],
        ["critic", 2],
      ]);
    });

    it("keeps sibling workers in start-time order under one planner", () => {
      const planner = makeSpan({ spanId: "p", startTime: 1 });
      const w2 = makeSpan({ spanId: "w2", startTime: 30, groupId: "g", parentRunId: "p" });
      const w1 = makeSpan({ spanId: "w1", startTime: 20, groupId: "g", parentRunId: "p" });

      const entries = flattenSpanForest([planner, w2, w1]);

      expect(entries.map((e) => e.span.spanId)).toEqual(["p", "w1", "w2"]);
      expect(entries.map((e) => e.depth)).toEqual([0, 1, 1]);
    });

    it("treats a span whose parent run is absent from the trace as a root", () => {
      // A worker whose planner lives in another trace must still appear.
      const orphan = makeSpan({
        spanId: "orphan",
        startTime: 5,
        groupId: "g",
        parentRunId: "missing-planner",
      });
      const sibling = makeSpan({ spanId: "sib", startTime: 6 });

      const entries = flattenSpanForest([orphan, sibling]);

      expect(entries.map((e) => e.span.spanId).sort()).toEqual(["orphan", "sib"]);
      expect(entries.every((e) => e.depth === 0)).toBe(true);
    });

    it("never loops or drops a span when parentRunId forms a cycle", () => {
      const a = makeSpan({ spanId: "a", startTime: 1, groupId: "g", parentRunId: "b" });
      const b = makeSpan({ spanId: "b", startTime: 2, groupId: "g", parentRunId: "a" });

      const entries = flattenSpanForest([a, b]);

      // Both spans are emitted exactly once; the cycle is broken, not followed.
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.span.spanId).sort()).toEqual(["a", "b"]);
    });

    it("ignores a span that names itself as its own parent run", () => {
      const selfRef = makeSpan({
        spanId: "self",
        startTime: 1,
        groupId: "g",
        parentRunId: "self",
      });

      const entries = flattenSpanForest([selfRef]);

      expect(entries).toEqual([{ span: selfRef, depth: 0 }]);
    });
  });

  it("returns an empty list for no spans", () => {
    expect(flattenSpanForest([])).toEqual([]);
    expect(hasRunNesting([])).toBe(false);
  });
});
